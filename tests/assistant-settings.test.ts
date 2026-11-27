import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { HumanRateLimiter } from '../src/domain/rate-limiter';
import type { ChatMessage } from '../src/domain/types';

test('settings persist across database close and reopen and are brand scoped',()=>{
  const dir=mkdtempSync(join(tmpdir(),'assistant-settings-'));
  try {
    const first=new MemoryStore({dataDir:dir});
    const model={generateContent:async()=>({text:''})};
    try {
      const agent=new ModeratorAgent(model,first,{brandId:'alpha'});
      agent.updateSettings({persona:{name:'Alpha',language:'en',rules:['Confirm stock']},policy:{minConfidence:0.87}});
    }finally{first.close();}
    const reopened=new MemoryStore({dataDir:dir});
    try{
      const alpha=new ModeratorAgent(model,reopened,{brandId:'alpha'});
      const beta=new ModeratorAgent(model,reopened,{brandId:'beta'});
      expect(alpha.getPersona()).toMatchObject({name:'Alpha',language:'en',rules:['Confirm stock']});
      expect(alpha.getPolicy().minConfidence).toBe(0.87);
      expect(beta.getPersona().name).not.toBe('Alpha');
    }finally{reopened.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('configured confidence, response language and delay reach the runtime',async()=>{
  const memory=new MemoryStore({dataDir:':memory:'});
  const limiter=new HumanRateLimiter();
  let prompt='';
  try {
    const agent=new ModeratorAgent({generateContent:async(_contents,options)=>{
      prompt=options?.systemInstruction??'';
      return {text:JSON.stringify({action:'reply',intent:'greeting',replyText:'Hello',reasoning:'Greeting',confidence:0.85})};
    }},memory,{rateLimiter:limiter});
    agent.updatePersona({language:'en-GB',minConfidence:0.95,minTypingDelayMs:123,maxTypingDelayMs:123});
    expect(limiter.calculateTypingDelay('Hello')).toBe(123);
    const message:ChatMessage={id:'m',chatId:'settings-test@s.whatsapp.net',sender:'settings-test',text:'Hello there',timestamp:Date.now(),isFromMe:false,type:'text'};
    const result=await agent.processInboundMessage(message,{dryRun:true});
    expect(prompt).toContain('en-GB');
    expect(result.shouldSendImmediately).toBe(false);
    expect(result.decision.action).toBe('human');
  }finally{memory.close();}
});
