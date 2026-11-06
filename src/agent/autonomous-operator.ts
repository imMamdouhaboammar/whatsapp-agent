import {randomUUID} from 'node:crypto';
import {BrandKnowledgeStore,type Evidence} from './brand-knowledge';
import {ActionJournal,ToolRegistry} from './tools';
import {WebScout,shouldUseWebScout} from './web-scout';

export interface Resolution {
  status:'answered'|'clarification'|'waiting_provider';
  reply:string;
  workflowId:string;
  evidence:Array<{kind:'provider'|'brand'|'web';source:string;versionId?:string;observedAt?:number}>;
}

export class AutonomousOperator {
  constructor(private readonly deps:{knowledge:BrandKnowledgeStore;registry:ToolRegistry;journal:ActionJournal;webScout?:Pick<WebScout,'search'>}){}

  async resolve(input:{brandId:string;contactId:string;text:string;workflowId?:string}):Promise<Resolution> {
    if(!input.brandId?.trim() || !input.contactId?.trim() || !input.text?.trim())throw new Error('Invalid agent turn');
    const workflowId=this.deps.journal.createWorkflow({
      brandId:input.brandId,contactId:input.contactId,goal:input.text,workflowId:input.workflowId??randomUUID()
    });
    const evidence:Resolution['evidence']=[];
    const finish=(status:Resolution['status'],reply:string):Resolution=>{
      this.deps.journal.updateWorkflow(input.brandId,workflowId,status==='answered'?'completed':status==='waiting_provider'?'waiting_provider':'needs_customer_detail');
      return {status,reply,workflowId,evidence};
    };
    const sku=input.text.match(/(?:SKU[-_][A-Za-z0-9_-]{1,80}|[A-Za-z][A-Za-z0-9]+[-_][A-Za-z0-9_-]{1,80})/i)?.[0];
    const tools=this.deps.registry.list(input.brandId);
    if(sku && tools.some(t=>t.name==='inventory.lookup' && t.kind==='read')) {
      this.deps.journal.updateWorkflow(input.brandId,workflowId,'gathering_evidence');
      try{
        const result=await this.deps.registry.run({
          brandId:input.brandId,toolName:'inventory.lookup',workflowId,
          idempotencyKey:'inventory:'+sku,input:{sku}
        });
        if(result.status!=='confirmed')return finish('waiting_provider','بنراجع بيانات المنتج مع المتجر، وهبلغك أول ما نتأكد.');
        const item=result.output as {sku?:string;stock?:number;price?:number;currency?:string;observedAt?:number;sourceUrl?:string}|null;
        if(!item || item.sku?.toLowerCase()!==sku.toLowerCase() || !Number.isSafeInteger(item.stock) || (item.stock??-1)<0) {
          return finish('clarification','مش قادر أتأكد من توفر المنتج حاليًا. ممكن تبعت اسم المنتج أو صورته؟');
        }
        evidence.push({kind:'provider',source:item.sourceUrl||'inventory.lookup',observedAt:item.observedAt??Date.now()});
        let reply='المنتج '+item.sku+' متوفر منه '+item.stock+' قطعة حاليًا';
        if(typeof item.price==='number' && Number.isFinite(item.price) && item.price>=0 && item.currency)reply+='، والسعر '+item.price+' '+item.currency;
        return finish('answered',reply+'.');
      }catch{
        return finish('waiting_provider','حاليًا مش قادر أتحقق من المخزون مباشرة. هحتاج أتأكد من المتجر قبل تحديد الكمية أو السعر.');
      }
    }
    // A policy conflict must be resolved by the owner, not guessed from document ranking.
    if(/(?:ارجاع|إرجاع|استرجاع|return|refund)/i.test(input.text) && this.deps.knowledge.listConflicts(input.brandId).some(c=>c.field==='returns_days')){
      return finish('clarification','فيه تعارض بين مصادر سياسة الإرجاع المتاحة؛ محتاجين نراجع السياسة المعتمدة قبل ما أؤكد المدة.');
    }
    const answer=await this.deps.knowledge.retrieve({brandId:input.brandId,question:input.text,limit:3});
    if(answer.evidence.length){
      const source=answer.evidence[0] as Evidence;
      evidence.push({kind:'brand',source:source.sourceId,versionId:source.versionId,observedAt:source.lastChecked});
      return finish('answered',source.text);
    }
    if(this.deps.webScout && shouldUseWebScout(input.text)) {
      try {
        const publicInfo=await this.deps.webScout.search({question:input.text,freshnessNeed:'current',maxSources:3});
        if(publicInfo.status==='grounded' && publicInfo.sources.length) {
          for(const source of publicInfo.sources)evidence.push({kind:'web',source:source.url,observedAt:source.observedAt});
          return finish('answered',publicInfo.answer+'\nالمصادر: '+publicInfo.sources.map(s=>s.url).join('، '));
        }
        return finish('clarification',publicInfo.answer);
      }catch{return finish('clarification','ما قدرتش أتحقق من أحدث معلومة من مصدر خارجي دلوقتي.');}
    }
    return finish('clarification',sku
      ? 'ممكن تأكدلي اسم المنتج أو رقم الموديل؟ ما عنديش مخزون موثوق للمنتج ده دلوقتي.'
      : 'ممكن تحددلي اسم المنتج أو رقم الطلب عشان أراجع التفاصيل بدقة؟');
  }
}
