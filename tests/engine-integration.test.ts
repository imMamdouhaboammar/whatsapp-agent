import { describe, expect, it } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';
import type { ChatMessage } from '../src/domain/types';

describe('Engine Integration & Autonomous Loop', () => {
  it('initializes agent engine with SQLite WAL and responds to API requests', async () => {
    const agent = await createFableWhatsAppAgent({
      port: 3999,
      dataDir: ':memory:',
      autoConnect: false
    });

    expect(agent).toBeDefined();
    expect(agent.memoryStore).toBeDefined();
    expect(agent.whatsappClient).toBeDefined();
    expect(agent.moderatorAgent).toBeDefined();

    // Verify REST status endpoint
    const res = await agent.app.request('/api/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.state).toBe('disconnected');
    expect(body.pendingDraftsCount).toBe(0);

    agent.memoryStore.close();
  });

  it('manages contact dossier via REST API', async () => {
    const agent = await createFableWhatsAppAgent({
      port: 3998,
      dataDir: ':memory:',
      autoConnect: false
    });

    const chatId = '201012345678@s.whatsapp.net';

    // 1. Get empty dossier
    const getRes1 = await agent.app.request(`/api/contacts/${chatId}/dossier`);
    expect(getRes1.status).toBe(200);
    const body1 = (await getRes1.json()) as any;
    expect(body1.dossier.chatId).toBe(chatId);
    expect(body1.dossier.stage).toBe('lead');
    expect(body1.dossier.facts).toEqual([]);

    // 2. Add fact
    const factRes = await agent.app.request(`/api/contacts/${chatId}/dossier/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact: 'العميل مهتم بخطة النمو السنوية' })
    });
    expect(factRes.status).toBe(200);
    const factBody = (await factRes.json()) as any;
    expect(factBody.dossier.facts).toContain('العميل مهتم بخطة النمو السنوية');

    // 3. Add commitment
    const commRes = await agent.app.request(`/api/contacts/${chatId}/dossier/commitments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitment: 'إرسال العقد للتوقيع يوم الأحد' })
    });
    expect(commRes.status).toBe(200);
    const commBody = (await commRes.json()) as any;
    expect(commBody.dossier.commitments).toContain('إرسال العقد للتوقيع يوم الأحد');

    // 4. Update stage
    const updateRes = await agent.app.request(`/api/contacts/${chatId}/dossier`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'negotiation' })
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as any;
    expect(updateBody.dossier.stage).toBe('negotiation');

    agent.memoryStore.close();
  });
});

describe('S01 no automated replies to history or duplicate inbound messages',()=>{
 it('persists historical messages but never adds them to the live burst queue',async()=>{
  const agent=await createFableWhatsAppAgent({dataDir:':memory:',autoConnect:false});
  try{
   const inbound:ChatMessage={id:'old-message-id',chatId:'201099900000@s.whatsapp.net',sender:'contact',text:'Hello from history',timestamp:Date.now()-100000,type:'text',isFromMe:false};
   const onMessage=(agent.whatsappClient as any).onMessageCallback as (msg:ChatMessage,meta?:{historical:boolean})=>Promise<void>;
   await onMessage(inbound,{historical:true});
   expect(agent.memoryStore.getMessage(inbound.chatId,inbound.id)?.text).toBe(inbound.text);
   expect(agent.burstAccumulator.hasPending(inbound.chatId)).toBe(false);
   await onMessage(inbound,{historical:false});
   expect(agent.burstAccumulator.hasPending(inbound.chatId)).toBe(false);
  }finally{agent.burstAccumulator.destroy();agent.capabilities.close();agent.memoryStore.close();}
 });
});

describe('E10 simulated WhatsApp-to-confirmed-provider round trip',()=>{
 it('runs socket inbound -> stored burst -> authorized stock lookup -> fake outbound -> saved receipt, without a network send',async()=>{
  const agent=await createFableWhatsAppAgent({
    dataDir:':memory:',autoConnect:false,capabilityAutopilotBrandId:'store'
  });
  const sent:Array<{chatId:string;text:string}>=[];
  const chatId='201018880000@s.whatsapp.net';
  try {
   agent.capabilities.registry.register('store',{
     name:'inventory.lookup',kind:'read',scope:'inventory:read',
     validate:(args):args is {sku:string}=>typeof (args as any)?.sku==='string',
     execute:async({sku})=>({sku,stock:3,price:240,currency:'SAR',observedAt:Date.now()})
   });
   (agent.whatsappClient as any).sendMessage=async(chat:string,text:string)=>{
     sent.push({chatId:chat,text});return {messageId:'simulated-sent-001'};
   };
   const inbound:ChatMessage={
     id:'inbound-001',chatId,sender:chatId,text:'هل SKU-42 موجود وبكام؟',
     timestamp:Date.now(),isFromMe:false,type:'text'
   };
   const handler=(agent.whatsappClient as any).onMessageCallback as (msg:ChatMessage,meta?:{historical:boolean})=>Promise<void>;
   await handler(inbound,{historical:false});
   expect(agent.burstAccumulator.hasPending(chatId)).toBe(true);
   await agent.burstAccumulator.flush(chatId);
   expect(sent).toHaveLength(1);
   expect(sent[0].text).toContain('SKU-42');
   expect(sent[0].text).toContain('240 SAR');
   expect(agent.memoryStore.getMessage(chatId,'simulated-sent-001')?.status).toBe('sent');
  } finally{
   agent.burstAccumulator.destroy();agent.capabilities.close();agent.memoryStore.close();
  }
 });

 it('manages contact memories and conversation style through REST API', async () => {
  const agent = await createFableWhatsAppAgent({
    dataDir: ':memory:',
    autoConnect: false
  });
  const contactJid = '201099988877@s.whatsapp.net';

  try {
    // 1. Save memory
    const saveReq = new Request(`http://localhost/api/contacts/${contactJid}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Prefers express delivery' })
    });
    const saveRes = await agent.app.fetch(saveReq);
    expect(saveRes.status).toBe(200);
    const saveBody: any = await saveRes.json();
    expect(saveBody.status).toBe('saved');

    // 2. Reject sensitive credentials
    const credReq = new Request(`http://localhost/api/contacts/${contactJid}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'my password is secret123' })
    });
    const credRes = await agent.app.fetch(credReq);
    expect(credRes.status).toBe(422);

    // 3. List memories
    const listReq = new Request(`http://localhost/api/contacts/${contactJid}/memories`);
    const listRes = await agent.app.fetch(listReq);
    expect(listRes.status).toBe(200);
    const listBody: any = await listRes.json();
    expect(listBody.memories.length).toBe(1);
    expect(listBody.memories[0].content).toBe('Prefers express delivery');

    // 4. Update style
    const styleReq = new Request(`http://localhost/api/chats/${contactJid}/style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: 'playful' })
    });
    const styleRes = await agent.app.fetch(styleReq);
    expect(styleRes.status).toBe(200);

    // 5. Get style
    const getStyleReq = new Request(`http://localhost/api/chats/${contactJid}/style`);
    const getStyleRes = await agent.app.fetch(getStyleReq);
    const styleBody: any = await getStyleRes.json();
    expect(styleBody.style).toBe('playful');
  } finally {
    agent.burstAccumulator.destroy();
    agent.capabilities.close();
    agent.memoryStore.close();
  }
 });
});
