import coreSpineJson from './data/core-spine.json';
import medicalJson from './data/industries/medical.json';
import ecommerceJson from './data/industries/ecommerce.json';
import realEstateJson from './data/industries/real-estate.json';
import tourismJson from './data/industries/tourism.json';
import hospitalityJson from './data/industries/hospitality.json';
import educationJson from './data/industries/education.json';
import type { CoreSpineConfig, IndustryId, IndustryPack } from './types';

export const CORE_SPINE = coreSpineJson as unknown as CoreSpineConfig;

export const INDUSTRY_PACKS: Record<IndustryId, IndustryPack> = {
  medical: medicalJson as unknown as IndustryPack,
  ecommerce: ecommerceJson as unknown as IndustryPack,
  real_estate: realEstateJson as unknown as IndustryPack,
  tourism: tourismJson as unknown as IndustryPack,
  hospitality: hospitalityJson as unknown as IndustryPack,
  education: educationJson as unknown as IndustryPack,
};