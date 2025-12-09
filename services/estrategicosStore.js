// services/estrategicosStore.js
//
// Store simples em arquivos JSON por conta:
//   data/estrategicos/estrategicos_drossi.json
//   data/estrategicos/estrategicos_diplany.json
//   data/estrategicos/estrategicos_rossidecor.json
//
// Cada item segue o formato:
// {
//   "mlb": "MLB123",
//   "name": "Nome opcional",
//   "default_percent": 19.0,
//   "last_applied_at": "2025-12-08T12:34:56.000Z" | null,
//   "last_applied_percent": 19.0 | null
// }

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', 'data', 'estrategicos');

// garante que a pasta existe
function ensureDir() {
  try {
    if (!fs.existsSync(BASE_DIR)) {
      fs.mkdirSync(BASE_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('[EstrategicosStore] erro ao criar diretório base:', e);
  }
}

// mapeia accountKey -> nome de arquivo
function fileForAccount(accountKey) {
  const k = (accountKey || 'default')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');

  // casos explícitos que você pediu
  if (k.includes('drossi')) return path.join(BASE_DIR, 'estrategicos_drossi.json');
  if (k.includes('diplany')) return path.join(BASE_DIR, 'estrategicos_diplany.json');
  if (k.includes('rossidecor')) return path.join(BASE_DIR, 'estrategicos_rossidecor.json');

  // fallback genérico
  return path.join(BASE_DIR, `estrategicos_${k}.json`);
}

function safeReadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const txt = fs.readFileSync(filePath, 'utf8');
    if (!txt.trim()) return [];
    const data = JSON.parse(txt);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[EstrategicosStore] erro ao ler JSON:', filePath, e);
    return [];
  }
}

function safeWriteJSON(filePath, data) {
  try {
    const tmp = `${filePath}.tmp`;
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[EstrategicosStore] erro ao gravar JSON:', filePath, e);
  }
}

class EstrategicosStore {
  /**
   * Lista todos os estratégicos da conta.
   * @param {string} accountKey
   * @returns {Array<{mlb:string,name?:string,default_percent?:number,last_applied_at?:string,last_applied_percent?:number}>}
   */
  static list(accountKey) {
    ensureDir();
    const file = fileForAccount(accountKey);
    return safeReadJSON(file);
  }

  /**
   * Salva a lista inteira (substitui).
   * @param {string} accountKey
   * @param {Array} items
   */
  static saveAll(accountKey, items) {
    ensureDir();
    const file = fileForAccount(accountKey);
    const arr = Array.isArray(items) ? items : [];
    safeWriteJSON(file, arr);
  }

  /**
   * Adiciona ou atualiza um item (upsert por MLB).
   * @param {string} accountKey
   * @param {{mlb:string,name?:string,default_percent?:number}} payload
   * @returns {object} item salvo
   */
  static upsert(accountKey, payload) {
    ensureDir();
    const file = fileForAccount(accountKey);
    const list = safeReadJSON(file);

    const mlb = String(payload.mlb || '').trim().toUpperCase();
    if (!mlb) {
      throw new Error('MLB obrigatório para salvar estratégico.');
    }

    const name = payload.name != null ? String(payload.name).trim() : null;
    const defPct = payload.default_percent != null
      ? Number(payload.default_percent)
      : null;

    const now = new Date().toISOString();

    const idx = list.findIndex(it => String(it.mlb || '').toUpperCase() === mlb);
    if (idx >= 0) {
      // update
      const cur = list[idx];
      const updated = {
        ...cur,
        mlb,
        ...(name !== null ? { name } : {}),
        ...(defPct !== null && !Number.isNaN(defPct) ? { default_percent: defPct } : {}),
        updated_at: now,
      };
      list[idx] = updated;
    } else {
      // insert
      const item = {
        mlb,
        ...(name ? { name } : {}),
        ...(defPct !== null && !Number.isNaN(defPct) ? { default_percent: defPct } : {}),
        created_at: now,
        updated_at: now,
        last_applied_at: null,
        last_applied_percent: null,
      };
      list.push(item);
    }

    safeWriteJSON(file, list);
    return list.find(it => String(it.mlb || '').toUpperCase() === mlb);
  }

  /**
   * Remove um item da lista pela MLB.
   * @param {string} accountKey
   * @param {string} mlb
   * @returns {boolean} true se removeu algo
   */
  static remove(accountKey, mlb) {
    ensureDir();
    const file = fileForAccount(accountKey);
    const list = safeReadJSON(file);

    const target = String(mlb || '').trim().toUpperCase();
    const next = list.filter(it => String(it.mlb || '').toUpperCase() !== target);

    const changed = next.length !== list.length;
    if (changed) safeWriteJSON(file, next);
    return changed;
  }

  /**
   * Atualiza informações de aplicação (quando rodar o job).
   * @param {string} accountKey
   * @param {string} mlb
   * @param {number} appliedPercent
   */
  static markApplied(accountKey, mlb, appliedPercent) {
    ensureDir();
    const file = fileForAccount(accountKey);
    const list = safeReadJSON(file);

    const target = String(mlb || '').trim().toUpperCase();
    const idx = list.findIndex(it => String(it.mlb || '').toUpperCase() === target);
    if (idx < 0) return;

    const now = new Date().toISOString();
    const pct = appliedPercent != null ? Number(appliedPercent) : null;

    list[idx] = {
      ...list[idx],
      last_applied_at: now,
      ...(pct != null && !Number.isNaN(pct) ? { last_applied_percent: pct } : {}),
      updated_at: now,
    };

    safeWriteJSON(file, list);
  }

  /**
   * Substitui a lista inteira a partir de um mapa (ex: upload CSV).
   * @param {string} accountKey
   * @param {Array<{mlb:string,name?:string,default_percent?:number}>} items
   * @param {boolean} preserveExisting Se true, apenas faz upsert; se false, remove os não listados
   */
  static replaceFromList(accountKey, items, preserveExisting = false) {
    ensureDir();
    const file = fileForAccount(accountKey);
    const current = safeReadJSON(file);
    const mapNew = new Map();

    const norm = (mlb) => String(mlb || '').trim().toUpperCase();

    for (const raw of items || []) {
      const mlb = norm(raw.mlb);
      if (!mlb) continue;
      const name = raw.name != null ? String(raw.name).trim() : null;
      const defPct = raw.default_percent != null ? Number(raw.default_percent) : null;
      mapNew.set(mlb, { mlb, name, default_percent: defPct });
    }

    const now = new Date().toISOString();
    const result = [];

    if (preserveExisting) {
      // apenas upsert nos existentes, mantém demais
      const merged = [...current];
      for (const [mlb, payload] of mapNew.entries()) {
        const idx = merged.findIndex(it => norm(it.mlb) === mlb);
        if (idx >= 0) {
          merged[idx] = {
            ...merged[idx],
            ...payload,
            updated_at: now,
          };
        } else {
          merged.push({
            ...payload,
            created_at: now,
            updated_at: now,
            last_applied_at: null,
            last_applied_percent: null,
          });
        }
      }
      safeWriteJSON(file, merged);
      return merged;
    }

    // modo "substituir": remove quem não estiver no arquivo
    for (const [mlb, payload] of mapNew.entries()) {
      const existing = current.find(it => norm(it.mlb) === mlb);
      if (existing) {
        result.push({
          ...existing,
          ...payload,
          updated_at: now,
        });
      } else {
        result.push({
          ...payload,
          created_at: now,
          updated_at: now,
          last_applied_at: null,
          last_applied_percent: null,
        });
      }
    }

    safeWriteJSON(file, result);
    return result;
  }
}

module.exports = EstrategicosStore;
