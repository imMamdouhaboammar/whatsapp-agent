import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContactIdentityDirectory,
  IdentityEvidenceError,
  RecipientBindingChangedError,
} from '../src/identity/contact-directory';

const brand = 'brand-alpha';
const phoneA = '201112223334@s.whatsapp.net';
const phoneB = '201112223335@s.whatsapp.net';
const lidA = '100002222333@lid';
const group = '120363000123456789@g.us';

describe('S07 canonical contact identities', () => {
  test('observations stay separate until an explicit verified phone-to-LID mapping', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      const phone = directory.observeAlias({ brandId: brand, jid: phoneA, displayName: 'Aya' });
      const lid = directory.observeAlias({ brandId: brand, jid: lidA, displayName: 'Aya' });
      expect(phone.contactId).not.toBe(lid.contactId);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.verified).toBe(false);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.verified).toBe(false);

      const decision = directory.verifyAliasRelationship({
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: lidA,
        source: 'provider_verified',
        evidenceRef: 'authenticated-lid-mapping-001',
      });
      expect(decision.created).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: lidA })!.contactId);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.verified).toBe(true);

      expect(directory.undoMerge({ brandId: brand, decisionId: decision.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: lidA })!.contactId);
    } finally {
      directory.close();
    }
  });

  test('matching display names or partial phone fragments never merge contacts', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      const first = directory.observeAlias({ brandId: brand, jid: phoneA, displayName: 'Ahmed' });
      const second = directory.observeAlias({ brandId: brand, jid: phoneB, displayName: 'Ahmed' });
      expect(first.contactId).not.toBe(second.contactId);
      const review = directory.queueReview({
        brandId: brand,
        firstJid: phoneA,
        secondJid: phoneB,
        reason: 'matching_display_name',
      });
      expect(review.state).toBe('pending');
      expect(directory.listPendingReviews(brand)).toHaveLength(1);
      expect(directory.resolve({ brandId: brand, jid: phoneB })?.contactId).toBe(second.contactId);
      expect(directory.dismissReview({ brandId: brand, reviewId: review.id })).toBe(true);
      expect(directory.listPendingReviews(brand)).toHaveLength(0);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId).toBe(first.contactId);
    } finally {
      directory.close();
    }
  });

  test('direct recipients and group destinations can never cross-merge', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: group });
      expect(directory.resolve({ brandId: brand, jid: group })?.kind).toBe('group');
      expect(() => directory.bindRecipient({ brandId: brand, jid: group })).toThrow();
      expect(() => directory.verifyAliasRelationship({
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: group,
        source: 'owner_verified',
        evidenceRef: 'owner-approved-001',
      })).toThrow(IdentityEvidenceError);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.kind).toBe('direct');
    } finally {
      directory.close();
    }
  });

  test('a queued send binding is rejected if a verified alias merge changes its contact', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      const queued = directory.bindRecipient({ brandId: brand, jid: lidA });
      expect(directory.revalidateRecipient(queued)).toBe(lidA);
      directory.verifyAliasRelationship({
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: lidA,
        source: 'provider_verified',
        evidenceRef: 'authenticated-lid-mapping-002',
      });
      expect(() => directory.revalidateRecipient(queued)).toThrow(RecipientBindingChangedError);
      const fresh = directory.bindRecipient({ brandId: brand, jid: lidA });
      expect(fresh.contactId).toBe(directory.resolve({ brandId: brand, jid: phoneA })!.contactId);
      expect(directory.revalidateRecipient(fresh)).toBe(lidA);
    } finally {
      directory.close();
    }
  });

  test('undo is durable across restart and does not reassign underlying aliases', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wa-identity-'));
    const dbPath = join(tempDir, 'contact-identities.sqlite');
    try {
      let directory = new ContactIdentityDirectory({ dbPath, verifyEvidence: () => true });
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      const aBefore = directory.resolve({ brandId: brand, jid: phoneA })?.rawContactId;
      const bBefore = directory.resolve({ brandId: brand, jid: lidA })?.rawContactId;
      const decision = directory.verifyAliasRelationship({
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: lidA,
        source: 'owner_verified',
        evidenceRef: 'review-case-001',
      });
      directory.close();

      directory = new ContactIdentityDirectory({ dbPath, verifyEvidence: () => true });
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: lidA })!.contactId);
      expect(directory.undoMerge({ brandId: brand, decisionId: decision.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.rawContactId).toBe(aBefore!);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.rawContactId).toBe(bBefore!);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: lidA })!.contactId);
      directory.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('brand boundaries and evidence allowlists prevent accidental reconciliation', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      const alpha = directory.observeAlias({ brandId: brand, jid: phoneA });
      const beta = directory.observeAlias({ brandId: 'brand-beta', jid: phoneA });
      expect(alpha.contactId).not.toBe(beta.contactId);
      expect(directory.resolve({ brandId: 'brand-beta', jid: lidA })).toBeUndefined();
      directory.observeAlias({ brandId: brand, jid: lidA });
      expect(() => directory.verifyAliasRelationship({
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: lidA,
        source: 'display_name' as 'owner_verified',
        evidenceRef: 'matching-name',
      })).toThrow(IdentityEvidenceError);
      expect(() => directory.verifyAliasRelationship({
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: lidA,
        source: 'owner_verified',
        evidenceRef: '',
      })).toThrow(IdentityEvidenceError);
    } finally {
      directory.close();
    }
  });

  test('unknown, malformed, and group JIDs cannot become direct send bindings', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      expect(() => directory.bindRecipient({ brandId: brand, jid: lidA })).toThrow();
      for (const jid of ['20111@s.whatsapp.net trailing', '20111@evil.example', '20111@s.whatsapp.net;DROP TABLE chats', '42']) {
        expect(() => directory.observeAlias({ brandId: brand, jid })).toThrow();
      }
      expect(() => directory.observeAlias({ brandId: '', jid: phoneA })).toThrow();
    } finally {
      directory.close();
    }
  });

  test('repeated verified evidence is idempotent while independent proofs remain reversible', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      const input = {
        brandId: brand,
        primaryJid: phoneA,
        relatedJid: lidA,
        source: 'owner_verified' as const,
        evidenceRef: 'verified-pair-one',
      };
      const first = directory.verifyAliasRelationship(input);
      const repeated = directory.verifyAliasRelationship(input);
      expect(repeated.id).toBe(first.id);
      expect(repeated.created).toBe(false);
      const reverse = directory.verifyAliasRelationship({
        ...input,
        primaryJid: lidA,
        relatedJid: phoneA,
        evidenceRef: 'verified-pair-two',
      });
      expect(reverse.created).toBe(true);
      expect(reverse.id).not.toBe(first.id);
      expect(directory.undoMerge({ brandId: brand, decisionId: first.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: phoneA })!.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: lidA })!.contactId);
    } finally {
      directory.close();
    }
  });
});

describe('S07 reversible merge graph and recipient stability', () => {
  test('undoing an upstream merge retains newer alias links with their original anchor', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      directory.observeAlias({ brandId: brand, jid: phoneB });
      const first = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'provider_verified', evidenceRef: 'lid-phone-link-001',
      });
      directory.verifyAliasRelationship({
        brandId: brand, primaryJid: lidA, relatedJid: phoneB,
        source: 'owner_verified', evidenceRef: 'related-contact-review-001',
      });
      expect(directory.resolve({ brandId: brand, jid: phoneB })?.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: phoneA })!.contactId);
      expect(directory.undoMerge({ brandId: brand, decisionId: first.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: phoneB })!.contactId);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: phoneA })!.contactId);
    } finally {
      directory.close();
    }
  });

  test('bindings do not become valid again after a merge is undone', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      const original = directory.bindRecipient({ brandId: brand, jid: lidA });
      const merged = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'provider_verified', evidenceRef: 'authenticated-lid-mapping-003',
      });
      const mergedBinding = directory.bindRecipient({ brandId: brand, jid: lidA });
      expect(() => directory.revalidateRecipient(original)).toThrow(RecipientBindingChangedError);
      expect(directory.undoMerge({ brandId: brand, decisionId: merged.id })).toBe(true);
      expect(() => directory.revalidateRecipient(original)).toThrow(RecipientBindingChangedError);
      expect(() => directory.revalidateRecipient(mergedBinding)).toThrow(RecipientBindingChangedError);
      expect(directory.revalidateRecipient(directory.bindRecipient({ brandId: brand, jid: lidA }))).toBe(lidA);
    } finally {
      directory.close();
    }
  });

  test('a pending possible-duplicate review closes on verified reconciliation', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      directory.queueReview({
        brandId: brand, firstJid: phoneA, secondJid: lidA,
        reason: 'transport_candidate',
      });
      expect(directory.listPendingReviews(brand)).toHaveLength(1);
      directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'provider_verified', evidenceRef: 'authenticated-lid-mapping-004',
      });
      expect(directory.listPendingReviews(brand)).toHaveLength(0);
    } finally {
      directory.close();
    }
  });
});

describe('S07 review reversibility and persisted identity evidence', () => {
  test('undo reopens the same review and removes the disputed alias verification', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      const review = directory.queueReview({
        brandId: brand, firstJid: phoneA, secondJid: lidA, reason: 'import_overlap',
      });
      const decision = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'owner_verified', evidenceRef: 'owner-review-evidence-005',
      });
      expect(directory.listPendingReviews(brand)).toHaveLength(0);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.verified).toBe(true);
      expect(directory.undoMerge({ brandId: brand, decisionId: decision.id })).toBe(true);
      expect(directory.listPendingReviews(brand).map(item => item.id)).toEqual([review.id]);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.verified).toBe(false);
    } finally {
      directory.close();
    }
  });
});


describe('S07 verified evidence graph integrity', () => {
  test('untrusted evidence cannot change canonical identity without an authority verifier', () => {
    const directory = new ContactIdentityDirectory();
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      expect(() => directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'provider_verified', evidenceRef: 'untrusted-evidence-001',
      })).toThrow(IdentityEvidenceError);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: lidA })?.contactId);
    } finally {
      directory.close();
    }
  });

  test('independent overlapping proof survives undo of earlier edge', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    const lidB = '100002222334@lid';
    try {
      for (const jid of [phoneA, phoneB, lidA, lidB]) directory.observeAlias({ brandId: brand, jid });
      const first = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'owner_verified', evidenceRef: 'verified-a-lid-006',
      });
      const later = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: lidA, relatedJid: phoneB,
        source: 'owner_verified', evidenceRef: 'verified-lid-b-007',
      });
      const independent = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: phoneB,
        source: 'owner_verified', evidenceRef: 'verified-a-b-008',
      });
      expect(independent.id).not.toBe(first.id);
      expect(independent.id).not.toBe(later.id);
      expect(directory.undoMerge({ brandId: brand, decisionId: first.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: phoneA })!.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: phoneB })!.contactId);
      expect(directory.resolve({ brandId: brand, jid: lidA })!.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: phoneB })!.contactId);
      expect(directory.undoMerge({ brandId: brand, decisionId: later.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: phoneA })!.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: phoneB })!.contactId);
      expect(directory.resolve({ brandId: brand, jid: lidA })!.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: phoneB })!.contactId);
    } finally {
      directory.close();
    }
  });

  test('undo respects remaining evidence when an alias participates in several decisions', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      for (const jid of [phoneA, phoneB, lidA]) directory.observeAlias({ brandId: brand, jid });
      const one = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'owner_verified', evidenceRef: 'first-owner-evidence-009',
      });
      const two = directory.verifyAliasRelationship({
        brandId: brand, primaryJid: phoneB, relatedJid: lidA,
        source: 'provider_verified', evidenceRef: 'second-mapping-evidence-010',
      });
      expect(directory.undoMerge({ brandId: brand, decisionId: one.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.verified).toBe(true);
      expect(directory.undoMerge({ brandId: brand, decisionId: two.id })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: lidA })?.verified).toBe(false);
    } finally {
      directory.close();
    }
  });

  test('an undone evidence event remains revoked when the same event is replayed', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      directory.observeAlias({ brandId: brand, jid: phoneA });
      directory.observeAlias({ brandId: brand, jid: lidA });
      const claim = {
        brandId: brand, primaryJid: phoneA, relatedJid: lidA,
        source: 'owner_verified' as const, evidenceRef: 'replayed-owner-review-011',
      };
      const first = directory.verifyAliasRelationship(claim);
      expect(directory.undoMerge({ brandId: brand, decisionId: first.id })).toBe(true);
      const replayed = directory.verifyAliasRelationship(claim);
      expect(replayed.created).toBe(false);
      expect(replayed.id).toBe(first.id);
      expect(directory.resolve({ brandId: brand, jid: phoneA })?.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: lidA })?.contactId);
      expect(directory.verifyAliasRelationship({ ...claim, evidenceRef: 'fresh-owner-review-012' }).created).toBe(true);
    } finally {
      directory.close();
    }
  });
});
describe('S07 deep reconciliation components', () => {
  test('a valid 129-link evidence chain remains resolvable and undoable', () => {
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      const ids = Array.from({ length: 130 }, (_, index) =>
        `${100000000000 + index}@lid`);
      for (const jid of ids) directory.observeAlias({ brandId: brand, jid });
      const firstRaw = directory.resolve({ brandId: brand, jid: ids[0]! })!.rawContactId;
      let lastDecision = '';
      for (let index = 0; index < ids.length - 1; index++) {
        lastDecision = directory.verifyAliasRelationship({
          brandId: brand, primaryJid: ids[index]!, relatedJid: ids[index + 1]!,
          source: 'provider_verified', evidenceRef: `provider-link-${index.toString().padStart(3, '0')}`,
        }).id;
      }
      expect(directory.resolve({ brandId: brand, jid: ids[129]! })!.contactId)
        .toBe(directory.resolve({ brandId: brand, jid: ids[0]! })!.contactId);
      expect(directory.resolve({ brandId: brand, jid: ids[0]! })?.rawContactId).toBe(firstRaw);
      expect(directory.undoMerge({ brandId: brand, decisionId: lastDecision })).toBe(true);
      expect(directory.resolve({ brandId: brand, jid: ids[129]! })?.contactId)
        .not.toBe(directory.resolve({ brandId: brand, jid: ids[0]! })?.contactId);
    } finally {
      directory.close();
    }
  });
});
