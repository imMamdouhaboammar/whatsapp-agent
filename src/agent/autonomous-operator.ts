import {randomUUID} from 'node:crypto';
import { isRecord } from '../mcp/records';
import type { BrandKnowledgeStore } from './brand-knowledge';
import type { ActionJournal, ToolRegistry } from './tools';
import { type WebScout, shouldUseWebScout } from './web-scout';

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
    // Reply in the customer's language: Arabic script anywhere means Arabic, otherwise English.
    const ar=/\p{Script=Arabic}/u.test(input.text);
    const say=(arabic:string,english:string)=>ar?arabic:english;
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
        if(result.status!=='confirmed')return finish('waiting_provider',say('بنراجع بيانات المنتج مع المتجر، وهبلغك أول ما نتأكد.',"We're checking the product details with the store and will tell you as soon as we confirm."));
        const item=result.output;
        if(!isRecord(item) || typeof item.sku!=='string' || item.sku.toLowerCase()!==sku.toLowerCase() ||
          typeof item.stock!=='number' || !Number.isSafeInteger(item.stock) || item.stock<0) {
          return finish('clarification',say('مش قادر أتأكد من توفر المنتج حاليًا. ممكن تبعت اسم المنتج أو صورته؟',"I can't confirm this product's availability right now. Could you send the product name or a photo?"));
        }
        const source = typeof item.sourceUrl==='string' && item.sourceUrl ? item.sourceUrl : 'inventory.lookup';
        const observedAt = typeof item.observedAt==='number' && Number.isFinite(item.observedAt) ? item.observedAt : Date.now();
        evidence.push({kind:'provider',source,observedAt});
        let reply=say('المنتج '+item.sku+' متوفر منه '+item.stock+' قطعة حاليًا',item.sku+' has '+item.stock+' in stock right now');
        if(typeof item.price==='number' && Number.isFinite(item.price) && item.price>=0 && typeof item.currency==='string' && item.currency)reply+=say('، والسعر ','. The price is ')+item.price+' '+item.currency;
        return finish('answered',reply+'.');
      }catch{
        return finish('waiting_provider',say('حاليًا مش قادر أتحقق من المخزون مباشرة. هحتاج أتأكد من المتجر قبل تحديد الكمية أو السعر.',"I can't check stock directly right now. I need to confirm with the store before giving a quantity or price."));
      }
    }
    // A policy conflict must be resolved by the owner, not guessed from document ranking.
    if(/(?:ارجاع|إرجاع|استرجاع|return|refund)/i.test(input.text) && this.deps.knowledge.listConflicts(input.brandId).some(c=>c.field==='returns_days')){
      return finish('clarification',say('فيه تعارض بين مصادر سياسة الإرجاع المتاحة؛ محتاجين نراجع السياسة المعتمدة قبل ما أؤكد المدة.','The available sources disagree on the return policy. We need to check the approved policy before I confirm the period.'));
    }
    const answer=await this.deps.knowledge.retrieve({brandId:input.brandId,question:input.text,limit:3});
    const brandEvidence=answer.evidence[0];
    if(brandEvidence){
      evidence.push({kind:'brand',source:brandEvidence.sourceId,versionId:brandEvidence.versionId,observedAt:brandEvidence.lastChecked});
      return finish('answered',brandEvidence.text);
    }
    if(this.deps.webScout && shouldUseWebScout(input.text)) {
      try {
        const publicInfo=await this.deps.webScout.search({question:input.text,freshnessNeed:'current',maxSources:3});
        if(publicInfo.status==='grounded' && publicInfo.sources.length) {
          for(const source of publicInfo.sources)evidence.push({kind:'web',source:source.url,observedAt:source.observedAt});
          return finish('answered',publicInfo.answer+say('\nالمصادر: ','\nSources: ')+publicInfo.sources.map(s=>s.url).join(say('، ',', ')));
        }
        // WebScout's fixed insufficient-evidence text is Arabic; render it in the customer's language.
        return finish('clarification',say(publicInfo.answer,"I couldn't verify a reliable public source right now. I need to check an official source before I confirm."));
      }catch{return finish('clarification',say('ما قدرتش أتحقق من أحدث معلومة من مصدر خارجي دلوقتي.',"I couldn't verify the latest information from an outside source right now."));}
    }
    return finish('clarification',sku
      ? say('ممكن تأكدلي اسم المنتج أو رقم الموديل؟ ما عنديش مخزون موثوق للمنتج ده دلوقتي.',"Could you confirm the product name or model number? I don't have reliable stock data for this product right now.")
      : say('ممكن تحددلي اسم المنتج أو رقم الطلب عشان أراجع التفاصيل بدقة؟','Could you tell me the product name or order number so I can check the details accurately?'));
  }
}
