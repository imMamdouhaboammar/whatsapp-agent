import {describe,expect,it} from 'bun:test';
import {WebScout,shouldUseWebScout} from '../src/agent/web-scout';

const makeModel=(response:any)=>{
  const calls:any[]=[];
  return {calls,generateContent:async (_contents:any,options:any)=>{calls.push(options);return response;}};
};

describe('A03 Web Scout grounding and provenance',()=>{
  it('searches volatile public questions with Google Search and preserves grounded URL and observed time',async()=>{
    const model=makeModel({text:'المعلومة متاحة',groundingMetadata:{groundingChunks:[
      {web:{uri:'https://www.spa.gov.sa/story',title:'Official update'}},
      {web:{uri:'http://localhost/admin',title:'unsafe'}},
      {web:{uri:'https://www.spa.gov.sa/story',title:'duplicate'}}
    ]}});
    const scout=new WebScout(model as any,()=>1700000000000);
    const answer=await scout.search({question:'ما آخر تعليمات حكومية اليوم؟',freshnessNeed:'current',maxSources:5});
    expect(model.calls[0].googleSearch).toBe(true);
    expect(answer.status).toBe('grounded');
    expect(answer.sources).toEqual([expect.objectContaining({url:'https://www.spa.gov.sa/story',title:'Official update',observedAt:1700000000000})]);
    expect(answer.answer).toBe('المعلومة متاحة');
  });
  it('refuses to assert a source-free model response',async()=>{
    const scout=new WebScout(makeModel({text:'بالطبع هذه حقيقة مؤكدة'}) as any);
    const result=await scout.search({question:'قرار جديد اليوم',freshnessNeed:'current'});
    expect(result.status).toBe('insufficient_evidence');
    expect(result.answer).not.toContain('مؤكدة');
  });
  it('routes external changing facts but not owned brand operating hours',()=>{
    expect(shouldUseWebScout('ما آخر أخبار الطرق اليوم؟')).toBe(true);
    expect(shouldUseWebScout('مواعيد الفرع عندكم ايه؟')).toBe(false);
  });
  it('filters out unsafe URLs containing credentials or non-standard ports',async()=>{
    const model=makeModel({text:'المعلومة',groundingMetadata:{groundingChunks:[
      {web:{uri:'https://user:secret@example.com/data',title:'credentials'}},
      {web:{uri:'https://example.com:8080/data',title:'custom port'}},
      {web:{uri:'https://clean.gov.sa/report',title:'valid'}}
    ]}});
    const scout=new WebScout(model as any);
    const answer=await scout.search({question:'أخبار اليوم',freshnessNeed:'current'});
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0].url).toBe('https://clean.gov.sa/report');
  });
});
