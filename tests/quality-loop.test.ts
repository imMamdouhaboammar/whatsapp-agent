import {test,expect} from 'bun:test';
import {QualityLoop} from '../src/agent/quality-loop';
test('A10 knowledge gap clustering redacts examples and stays brand-scoped',()=>{
 const loop=new QualityLoop({dbPath:':memory:'});
 const examples=['موعد وصول الطلب','متى التوصيل؟','الطلب هيجي امتى؟'];
 examples.forEach((question,i)=>loop.record({brandId:'a',scenarioId:'g'+i,intent:'shipping_eta',resolved:false,supported:false,question,missingSource:'delivery-provider',customerPhone:'2010000000'}));
 const gaps=loop.gaps('a');
 expect(gaps).toHaveLength(1);
 expect(gaps[0]?.count).toBe(3);
 expect(JSON.stringify(gaps)).not.toContain('2010000000');
 expect(loop.gaps('b')).toHaveLength(0);
 loop.close();
});
test('A10 scorecard computes real denominators, not fabricated successes',()=>{
 const loop=new QualityLoop({dbPath:':memory:'});
 loop.record({brandId:'a',scenarioId:'pass',intent:'stock',resolved:true,supported:true,question:'SKU',missingSource:undefined});
 loop.record({brandId:'a',scenarioId:'fail',intent:'stock',resolved:false,supported:false,question:'Unknown',missingSource:'inventory'});
 const stats=loop.scorecard('a');
 expect(stats.attempts).toBe(2);
 expect(stats.resolved).toBe(1);
 expect(stats.supported).toBe(1);
 expect(stats.autonomousResolutionRate).toBe(.5);
 expect(loop.scorecard('b').autonomousResolutionRate).toBeNull();
 loop.close();
});
test('A10 replay blocks proposed changes that regress a required scenario',()=>{
 const loop=new QualityLoop({dbPath:':memory:'});
 expect(loop.shouldPromote([{scenarioId:'E01',before:true,after:false,required:true}])).toBe(false);
 expect(loop.shouldPromote([{scenarioId:'E01',before:true,after:true,required:true}])).toBe(true);
 loop.close();
});
