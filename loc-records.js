// loc-records.js - which localization key stands for each hex / building record of every package. Pure: no DOM, no editor
// globals, loadable by the page (<script>) and by `require`. Nothing passed in is modified.
//
// Why: the Localization Keys manager should already hold a row for every tile and building that was published, so nobody types
// them by hand (only UI and custom keys are typed). A record names its key in `textId`; many records have it empty.
//
// Key of a record, first match wins:
//   own        textId is set
//   legacy     base record, textId empty, and the old convention key exists (Plain_1 -> plain_key: id lower case, no _N, + _key)
//   skinSlot   package record repainting a base record (explicit skinSlot) -> the key of that base record
//   stripped   package record whose id minus package prefixes equals a base id of a compatible type -> that base key
//   generated  <id lower case>_key
// A package record never gets a text of its own when a base record stands for it: it shows the base translation.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LocRecords = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const low = s => String(s == null ? '' : s).trim().toLowerCase();
  const norm = s => low(s).replace(/[^a-z0-9]/g, '');
  const isBase = r => !r.package || r.package === 'postapoc';
  const isWater = r => /water/i.test(String(r.type || ''));
  const pkgOf = r => r.package || 'postapoc';

  // Same rule as the editor's idPrefix() and map-convert.js: 'hs' -> 'Hs_', 'medieval-2-0' -> 'Medieval20_'.
  function prefixOf(pkgId) {
    if (!pkgId || pkgId === 'postapoc') return '';
    return String(pkgId).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('') + '_';
  }

  // Same compatibility as SkinSlotRules: hexes need an equal type, buildings only water vs ground.
  function compatible(kind, base, rec) {
    if (kind === 'bld') return isWater(base) === isWater(rec);
    return low(base.type) === low(rec.type);
  }

  const generatedKey = id => low(id) + '_key';
  const legacyKey = id => low(id).replace(/_\d+$/, '') + '_key';

  // id minus every package prefix, however many are stacked (Hs_Decameroon_Plain_1 -> Plain_1).
  function stripPrefixes(id, prefixes) {
    let s = String(id || ''), again = true;
    while (again) {
      again = false;
      for (const p of prefixes) {
        if (p && s.length > p.length && s.toLowerCase().startsWith(p.toLowerCase())) { s = s.slice(p.length); again = true; break; }
      }
    }
    return s;
  }

  // 'Hs_Decameroon_GoldMine_Big_1' -> 'Gold Mine Big': a readable default English text; people refine it.
  function humanize(id, prefixes) {
    let s = stripPrefixes(id, prefixes || []).replace(/_\d+$/, '');
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_+/g, ' ').trim();
    return s || String(id || '');
  }

  /**
   * @param ctx { hex: [...], bld: [...], entries: [{key,...}], packageIds?: [...] }
   * @returns { links, seeds }
   *   links: one per record { kind: 'hex'|'bld', id, package, key, how, linked, base? }   (linked: textId already equals key)
   *   seeds: entries to add for keys that no entry has yet { key, en, uk: '', group }
   */
  function plan(ctx) {
    const entries = (ctx && ctx.entries) || [];
    const have = new Set(entries.map(e => String(e.key)));
    const kinds = [['hex', (ctx && ctx.hex) || [], 'Tiles'], ['bld', (ctx && ctx.bld) || [], 'Buildings']];
    const pkgIds = new Set((ctx && ctx.packageIds) || []);
    for (const [, recs] of kinds) for (const r of recs) pkgIds.add(pkgOf(r));
    const prefixes = [...pkgIds].map(prefixOf).filter(Boolean);

    const links = [], seeds = [], seeded = new Set();
    const seed = (key, kind, group, rec) => {
      if (have.has(key) || seeded.has(key)) return;
      seeded.add(key);
      seeds.push({ key, en: humanize(rec.id, prefixes), uk: '', group });
    };

    for (const [kind, recs, group] of kinds) {
      const base = recs.filter(r => r && r.id != null && isBase(r));
      const baseKey = new Map();           // lower-case base id -> its key
      const baseNorm = new Map();          // normalized base id -> base record (only when unambiguous)
      const clash = new Set();

      for (const r of base) {
        const own = String(r.textId || '').trim();
        let key, how;
        if (own) { key = own; how = 'own'; }
        else if (have.has(legacyKey(r.id))) { key = legacyKey(r.id); how = 'legacy'; }
        else { key = generatedKey(r.id); how = 'generated'; }
        baseKey.set(low(r.id), { key, rec: r });
        const n = norm(r.id);
        if (baseNorm.has(n)) clash.add(n); else baseNorm.set(n, r);
        links.push({ kind, id: r.id, package: 'postapoc', key, how, linked: !!own });
        seed(key, kind, group, r);
      }

      for (const r of recs) {
        if (!r || r.id == null || isBase(r)) continue;
        const own = String(r.textId || '').trim();
        let key, how, from = null;
        if (own) { key = own; how = 'own'; }
        else {
          const slot = String(r.skinSlot || '').trim();
          let b = slot ? baseKey.get(low(slot)) : null;
          if (b && compatible(kind, b.rec, r)) { key = b.key; how = 'skinSlot'; from = b.rec.id; }
          else {
            const s = stripPrefixes(r.id, prefixes);
            b = baseKey.get(low(s));
            if (!b) { const n = norm(s); if (!clash.has(n) && baseNorm.has(n)) b = baseKey.get(low(baseNorm.get(n).id)); }
            if (b && compatible(kind, b.rec, r)) { key = b.key; how = 'stripped'; from = b.rec.id; }
            else { key = generatedKey(r.id); how = 'generated'; }
          }
        }
        const link = { kind, id: r.id, package: pkgOf(r), key, how, linked: !!own };
        if (from) link.base = from;
        links.push(link);
        seed(key, kind, group, r);
      }
    }
    return { links, seeds };
  }

  // key -> { [package]: [link, ...] }
  function byKey(links) {
    const out = {};
    for (const l of links) ((out[l.key] || (out[l.key] = {}))[l.package] || (out[l.key][l.package] = [])).push(l);
    return out;
  }

  return { plan, byKey, humanize, legacyKey, generatedKey, prefixOf, stripPrefixes };
}));
