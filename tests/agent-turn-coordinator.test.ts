import {describe,expect,it} from 'bun:test';
import {AgentTurnCoordinator} from '../src/agent/turn-coordinator';
import type {ChatMessage} from '../src/domain/types';

const msg:ChatMessage={id:'inbound1',chatId:'201010000000@s.whatsapp.net',sender:'contact',text:'كم مخزون SKU-42?',type:'text',timestamp:1,isFromMe:false};
const agentReply={decision:{action:'reply',intent:'general_faq',replyText:'legacy',confidence:1,reasoning:'base'},shouldSendImmediately:true};
const makeFixtures=(mode:'autopilot'|'copilot'|'human'='autopilot')=>{
 const calls:string[]=[];
 const moderator={processInboundMessage:async()=>{calls.push('moderator');return agentReply;}};
 const memory={getChat:()=>({agentMode:mode})};
 const operator={resolve:async(input:any)=>{calls.push('operator:'+input.brandId);return {status:'answered',reply:'SKU-42 7 قطع',workflowId:'flow',evidence:[{kind:'provider',source:'inventory.lookup'}]};}};
 return {calls,moderator,memory,operator};
};
describe('Live WhatsApp turn coordination',()=>{
 it('uses verified provider result for explicitly enabled brand on Autopilot only',async()=>{
   const f=makeFixtures();
   const handler=new AgentTurnCoordinator({moderator:f.moderator as any,memory:f.memory as any,operator:f.operator as any,brandId:'shop_1',enabled:true});
   const result=await handler.processInboundMessage(msg);
   expect(result.shouldSendImmediately).toBe(true);
   expect(result.decision.replyText).toBe('SKU-42 7 قطع');
   expect(f.calls).toEqual(['operator:shop_1']);
 });
 it('always delegates to existing permission and mode policies when disabled or human',async()=>{
   for (const mode of ['human','copilot'] as const){
     const f=makeFixtures(mode);
     const handler=new AgentTurnCoordinator({moderator:f.moderator as any,memory:f.memory as any,operator:f.operator as any,brandId:'shop_1',enabled:true});
     expect((await handler.processInboundMessage(msg)).decision.replyText).toBe('legacy');
     expect(f.calls).toEqual(['moderator']);
   }
   const f=makeFixtures();
   const h=new AgentTurnCoordinator({moderator:f.moderator as any,memory:f.memory as any,operator:f.operator as any,brandId:'shop_1',enabled:false});
   await h.processInboundMessage(msg);
   expect(f.calls).toEqual(['moderator']);
 });
 it('does not turn missing, uncertain or group evidence into autonomous send',async()=>{
   const f=makeFixtures();
   f.operator.resolve=async()=>{f.calls.push('operator');return {status:'waiting_provider',reply:'لا أعلم',workflowId:'flow',evidence:[]}};
   const handler=new AgentTurnCoordinator({moderator:f.moderator as any,memory:f.memory as any,operator:f.operator as any,brandId:'shop_1',enabled:true});
   expect((await handler.processInboundMessage(msg)).decision.replyText).toBe('legacy');
   expect(f.calls).toEqual(['operator','moderator']);
   f.calls.length=0;
   await handler.processInboundMessage({...msg,chatId:'a@g.us'});
   expect(f.calls).toEqual(['moderator']);
 });
});
