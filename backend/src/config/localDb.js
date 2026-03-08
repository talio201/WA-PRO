const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { supabase: supabaseConfig = {}, storage: storageConfig = {} } = require('./config');

const DB_PATH = path.join(__dirname, '../../data/db.json');
const DEFAULT_LOCAL_DB = { campaigns: [], messages: [], conversation_assignments: [] };

let sharedSupabaseClient = null;
let hasWarnedSupabaseFallback = false;
let hasWarnedSupabaseAnonOnly = false;

function ensureLocalDbFile() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_LOCAL_DB, null, 2));
    }
}

function ensureLocalCollectionExists(db, collection) {
    if (!Array.isArray(db[collection])) {
        db[collection] = [];
    }
}

function resolveStorageProvider() {
    return String(
        process.env.STORAGE_PROVIDER
        || process.env.DB_PROVIDER
        || storageConfig.provider
        || (process.env.SUPABASE_ENABLED === 'true' ? 'supabase' : 'local')
    )
        .trim()
        .toLowerCase();
}

function toIsoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function stripFunctionsDeep(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(stripFunctionsDeep);
    if (!value || typeof value !== 'object') return value;

    const result = {};
    Object.entries(value).forEach(([key, item]) => {
        if (typeof item === 'function') return;
        result[key] = stripFunctionsDeep(item);
    });
    return result;
}

function getNestedValue(item, pathExpression) {
    return String(pathExpression || '')
        .split('.')
        .filter(Boolean)
        .reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), item);
}

function setNestedValue(item, pathExpression, value) {
    const keys = String(pathExpression || '').split('.').filter(Boolean);
    if (keys.length === 0) return;

    let cursor = item;
    for (let index = 0; index < keys.length - 1; index += 1) {
        const key = keys[index];
        if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }

    cursor[keys[keys.length - 1]] = value;
}

function applyUpdateObject(current, update) {
    const next = stripFunctionsDeep(current || {});
    const patch = stripFunctionsDeep(update || {});

    if (patch.$inc && typeof patch.$inc === 'object') {
        Object.entries(patch.$inc).forEach(([field, increment]) => {
            const currentValue = Number(getNestedValue(next, field) || 0);
            const safeIncrement = Number(increment || 0);
            setNestedValue(next, field, currentValue + safeIncrement);
        });
    }

    Object.entries(patch).forEach(([field, value]) => {
        if (field.startsWith('$')) return;
        if (field.includes('.')) {
            setNestedValue(next, field, value);
            return;
        }
        next[field] = value;
    });

    return next;
}

function compareValues(aValue, bValue) {
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;

    if (typeof aValue === 'number' && typeof bValue === 'number') {
        return aValue - bValue;
    }

    const dateA = new Date(aValue);
    const dateB = new Date(bValue);
    const dateAValid = !Number.isNaN(dateA.getTime());
    const dateBValid = !Number.isNaN(dateB.getTime());

    if (dateAValid && dateBValid) {
        return dateA.getTime() - dateB.getTime();
    }

    return String(aValue).localeCompare(String(bValue));
}

function sortItems(items, sortSpec = {}) {
    const entries = Object.entries(sortSpec || {});
    if (entries.length === 0) return [...items];

    const [field, direction] = entries[0];
    const sortDirection = Number(direction) >= 0 ? 1 : -1;

    return [...items].sort((aItem, bItem) => {
        const aValue = field.includes('.') ? getNestedValue(aItem, field) : aItem[field];
        const bValue = field.includes('.') ? getNestedValue(bItem, field) : bItem[field];
        return compareValues(aValue, bValue) * sortDirection;
    });
}

function projectItems(items, selectExpression) {
    const fields = String(selectExpression || '')
        .split(/\s+/)
        .map((field) => field.trim())
        .filter(Boolean);

    if (fields.length === 0) return items;

    const positiveFields = fields.filter((field) => !field.startsWith('-'));
    if (positiveFields.length === 0) return items;

    return items.map((item) => {
        const projection = {};
        positiveFields.forEach((field) => {
            const key = field.trim();
            if (Object.prototype.hasOwnProperty.call(item, key)) {
                projection[key] = item[key];
            }
        });
        return projection;
    });
}

function matchesQuery(item, query = {}) {
    return Object.entries(query || {}).every(([field, expected]) => {
        const actual = field.includes('.') ? getNestedValue(item, field) : item[field];

        if (
            expected
            && typeof expected === 'object'
            && !Array.isArray(expected)
            && Object.prototype.hasOwnProperty.call(expected, '$in')
        ) {
            const values = Array.isArray(expected.$in) ? expected.$in : [];
            return values.includes(actual);
        }

        return actual === expected;
    });
}

function getSupabaseClient() {
    if (sharedSupabaseClient) return sharedSupabaseClient;

    const url = String(process.env.SUPABASE_URL || supabaseConfig.url || '').trim();
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseConfig.serviceRoleKey || '').trim();
    const anonKey = String(process.env.SUPABASE_ANON_KEY || supabaseConfig.anonKey || '').trim();
    const key = serviceRoleKey || anonKey;

    if (!url || !key) return null;

    if (!serviceRoleKey && anonKey && !hasWarnedSupabaseAnonOnly) {
        hasWarnedSupabaseAnonOnly = true;
        console.warn('SUPABASE_SERVICE_ROLE_KEY is missing. Backend is using SUPABASE_ANON_KEY and may fail with permission denied.');
    }

    sharedSupabaseClient = createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    return sharedSupabaseClient;
}

function removeUndefinedFields(item) {
    const output = {};
    Object.entries(item || {}).forEach(([key, value]) => {
        if (value !== undefined) {
            output[key] = value;
        }
    });
    return output;
}

function mapFieldToDb(collection, field) {
    if (collection === 'campaigns') {
        const map = {
            _id: 'id',
            messageTemplate: 'message_template',
            messageVariants: 'message_variants',
            turboMode: 'turbo_mode',
            antiBan: 'anti_ban',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        };
        return map[field] || field;
    }

    if (collection === 'messages') {
        const map = {
            _id: 'id',
            campaign: 'campaign_id',
            phoneOriginal: 'phone_original',
            searchTerms: 'search_terms',
            processedMessage: 'processed_message',
            attemptCount: 'attempt_count',
            lastError: 'last_error',
            sentAt: 'sent_at',
            lastAttemptAt: 'last_attempt_at',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        };
        return map[field] || field;
    }

    if (collection === 'conversation_assignments') {
        const map = {
            _id: 'id',
            campaignId: 'campaign_id',
            assignedTo: 'assigned_to',
            assignedBy: 'assigned_by',
            assignedAt: 'assigned_at',
            updatedAt: 'updated_at',
            closedAt: 'closed_at',
            lastInboundAt: 'last_inbound_at',
        };
        return map[field] || field;
    }

    return field;
}

function mapCampaignFromDb(row) {
    if (!row) return null;

    return {
        _id: row.id,
        name: row.name || '',
        messageTemplate: row.message_template || '',
        messageVariants: Array.isArray(row.message_variants) ? row.message_variants : [],
        turboMode: Boolean(row.turbo_mode),
        status: row.status || 'running',
        antiBan: row.anti_ban || { minDelaySeconds: 0, maxDelaySeconds: 120 },
        stats: row.stats || { total: 0, sent: 0, failed: 0 },
        media: row.media || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
    };
}

function mapMessageFromDb(row) {
    if (!row) return null;

    return {
        _id: row.id,
        campaign: row.campaign_id || null,
        phone: row.phone || '',
        phoneOriginal: row.phone_original || '',
        searchTerms: Array.isArray(row.search_terms) ? row.search_terms : [],
        name: row.name || '',
        variables: row.variables || null,
        processedMessage: row.processed_message || '',
        status: row.status || 'pending',
        direction: row.direction || 'outbound',
        attemptCount: Number(row.attempt_count || 0),
        error: row.error || null,
        lastError: row.last_error || null,
        audit: Array.isArray(row.audit) ? row.audit : [],
        sentAt: row.sent_at || null,
        lastAttemptAt: row.last_attempt_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
    };
}

function mapFromDb(collection, row) {
    if (collection === 'campaigns') return mapCampaignFromDb(row);
    if (collection === 'messages') return mapMessageFromDb(row);
    if (collection === 'conversation_assignments') {
        if (!row) return null;
        return {
            _id: row.id,
            phone: row.phone || '',
            campaignId: row.campaign_id || null,
            assignedTo: row.assigned_to || '',
            assignedBy: row.assigned_by || '',
            status: row.status || 'active',
            assignedAt: row.assigned_at || null,
            lastInboundAt: row.last_inbound_at || null,
            closedAt: row.closed_at || null,
            updatedAt: row.updated_at || null,
            notes: row.notes || '',
        };
    }
    return row;
}

function mapCampaignToDb(item) {
    const payload = {
        id: item._id,
        name: item.name,
        message_template: item.messageTemplate,
        message_variants: Array.isArray(item.messageVariants) ? item.messageVariants : [],
        turbo_mode: Boolean(item.turboMode),
        status: item.status || 'running',
        anti_ban: item.antiBan || { minDelaySeconds: 0, maxDelaySeconds: 120 },
        stats: item.stats || { total: 0, sent: 0, failed: 0 },
        media: item.media || null,
        created_at: toIsoDate(item.createdAt),
        updated_at: toIsoDate(item.updatedAt),
    };

    return removeUndefinedFields(payload);
}

function mapMessageToDb(item) {
    const payload = {
        id: item._id,
        campaign_id: item.campaign || null,
        phone: item.phone,
        phone_original: item.phoneOriginal || '',
        search_terms: Array.isArray(item.searchTerms) ? item.searchTerms : [],
        name: item.name || '',
        variables: item.variables || null,
        processed_message: item.processedMessage || '',
        status: item.status || 'pending',
        direction: item.direction || 'outbound',
        attempt_count: Number(item.attemptCount || 0),
        error: item.error || null,
        last_error: item.lastError || null,
        audit: Array.isArray(item.audit) ? item.audit : [],
        sent_at: toIsoDate(item.sentAt),
        last_attempt_at: toIsoDate(item.lastAttemptAt),
        created_at: toIsoDate(item.createdAt),
        updated_at: toIsoDate(item.updatedAt),
    };

    return removeUndefinedFields(payload);
}

function mapToDb(collection, item) {
    if (collection === 'campaigns') return mapCampaignToDb(item);
    if (collection === 'messages') return mapMessageToDb(item);
    if (collection === 'conversation_assignments') {
        const payload = {
            id: item._id,
            phone: item.phone || '',
            campaign_id: item.campaignId || null,
            assigned_to: item.assignedTo || '',
            assigned_by: item.assignedBy || '',
            status: item.status || 'active',
            assigned_at: toIsoDate(item.assignedAt),
            last_inbound_at: toIsoDate(item.lastInboundAt),
            closed_at: toIsoDate(item.closedAt),
            updated_at: toIsoDate(item.updatedAt),
            notes: item.notes || '',
        };
        return removeUndefinedFields(payload);
    }
    return item;
}

class LocalDB {
    constructor(collection) {
        this.collection = collection;
        this.provider = resolveStorageProvider();
        this.supabaseClient = this.provider === 'supabase' ? getSupabaseClient() : null;

        if (this.provider === 'supabase' && !this.supabaseClient) {
            if (!hasWarnedSupabaseFallback) {
                hasWarnedSupabaseFallback = true;
                console.warn('Supabase provider requested, but SUPABASE_URL/SUPABASE_KEY are missing. Falling back to local JSON DB.');
            }
            this.provider = 'local';
        }

        if (this.provider === 'local') {
            ensureLocalDbFile();
        }
    }

    _isSupabaseEnabled() {
        return this.provider === 'supabase' && Boolean(this.supabaseClient);
    }

    _readDB() {
        try {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return JSON.parse(JSON.stringify(DEFAULT_LOCAL_DB));
        }
    }

    _writeDB(data) {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    }

    _buildSupabaseQuery(baseQuery, query = {}) {
        let request = baseQuery;

        Object.entries(query || {}).forEach(([field, expected]) => {
            const dbField = mapFieldToDb(this.collection, field);

            if (
                expected
                && typeof expected === 'object'
                && !Array.isArray(expected)
                && Object.prototype.hasOwnProperty.call(expected, '$in')
            ) {
                const values = (Array.isArray(expected.$in) ? expected.$in : [])
                    .map((value) => stripFunctionsDeep(value));
                request = request.in(dbField, values);
                return;
            }

            request = request.eq(dbField, stripFunctionsDeep(expected));
        });

        return request;
    }

    async _readCollection(query = {}) {
        if (!this._isSupabaseEnabled()) {
            const db = this._readDB();
            ensureLocalCollectionExists(db, this.collection);
            const collection = Array.isArray(db[this.collection]) ? db[this.collection] : [];
            const items = collection.map((item) => stripFunctionsDeep(item));
            return items.filter((item) => matchesQuery(item, query));
        }

        const baseQuery = this.supabaseClient.from(this.collection).select('*');
        const request = this._buildSupabaseQuery(baseQuery, query);
        const { data, error } = await request;

        if (error) {
            throw new Error(`Supabase read error (${this.collection}): ${error.message}`);
        }

        return (Array.isArray(data) ? data : []).map((row) => mapFromDb(this.collection, row));
    }

    // Mongoose-like basics
    find(query = {}) {
        const basePromise = this._readCollection(query);

        const chain = {
            _sort: null,
            _select: null,
            _limit: null,
            sort(sortSpec) {
                this._sort = sortSpec;
                return this;
            },
            select(selectExpression) {
                this._select = selectExpression;
                return this;
            },
            limit(limitValue) {
                const parsed = Number(limitValue);
                this._limit = Number.isFinite(parsed) ? parsed : null;
                return this;
            },
            then(onFulfilled, onRejected) {
                const resultPromise = basePromise.then((items) => {
                    let output = [...items];

                    if (this._sort && typeof this._sort === 'object') {
                        output = sortItems(output, this._sort);
                    }

                    if (Number.isFinite(this._limit)) {
                        output = output.slice(0, Math.max(0, this._limit));
                    }

                    if (this._select) {
                        output = projectItems(output, this._select);
                    }

                    return output;
                });

                return resultPromise.then(onFulfilled, onRejected);
            },
            catch(onRejected) {
                return this.then((result) => result, onRejected);
            },
        };

        return chain;
    }

    async findById(id) {
        const targetId = String(id || '').trim();
        if (!targetId) return null;

        if (!this._isSupabaseEnabled()) {
            const db = this._readDB();
            ensureLocalCollectionExists(db, this.collection);
            const collection = Array.isArray(db[this.collection]) ? db[this.collection] : [];
            const item = collection.find((entry) => entry._id === targetId);
            return item ? stripFunctionsDeep(item) : null;
        }

        const dbIdField = mapFieldToDb(this.collection, '_id');
        const { data, error } = await this.supabaseClient
            .from(this.collection)
            .select('*')
            .eq(dbIdField, targetId)
            .limit(1);

        if (error) {
            throw new Error(`Supabase findById error (${this.collection}): ${error.message}`);
        }

        if (!Array.isArray(data) || data.length === 0) return null;
        return mapFromDb(this.collection, data[0]);
    }

    async create(data) {
        const now = new Date().toISOString();
        const payload = stripFunctionsDeep(data || {});
        const newItem = {
            _id: payload._id || crypto.randomUUID(),
            ...payload,
        };

        if (!newItem.createdAt) newItem.createdAt = now;
        if (!newItem.updatedAt) newItem.updatedAt = newItem.createdAt;

        if (!this._isSupabaseEnabled()) {
            const db = this._readDB();
            ensureLocalCollectionExists(db, this.collection);
            db[this.collection].push(newItem);
            this._writeDB(db);
            return newItem;
        }

        const dbPayload = mapToDb(this.collection, newItem);
        const { data: inserted, error } = await this.supabaseClient
            .from(this.collection)
            .insert(dbPayload)
            .select('*')
            .limit(1);

        if (error) {
            throw new Error(`Supabase create error (${this.collection}): ${error.message}`);
        }

        const insertedRow = Array.isArray(inserted) ? inserted[0] : null;
        return mapFromDb(this.collection, insertedRow);
    }

    async insertMany(items = []) {
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) return [];

        const now = new Date().toISOString();
        const normalized = list.map((item) => {
            const payload = stripFunctionsDeep(item || {});
            const newItem = {
                _id: payload._id || crypto.randomUUID(),
                ...payload,
            };

            if (!newItem.createdAt) newItem.createdAt = now;
            if (!newItem.updatedAt) newItem.updatedAt = newItem.createdAt;

            return newItem;
        });

        if (!this._isSupabaseEnabled()) {
            const db = this._readDB();
            ensureLocalCollectionExists(db, this.collection);
            db[this.collection].push(...normalized);
            this._writeDB(db);
            return normalized;
        }

        const payload = normalized.map((item) => mapToDb(this.collection, item));
        const { data: inserted, error } = await this.supabaseClient
            .from(this.collection)
            .insert(payload)
            .select('*');

        if (error) {
            throw new Error(`Supabase insertMany error (${this.collection}): ${error.message}`);
        }

        return (Array.isArray(inserted) ? inserted : []).map((row) => mapFromDb(this.collection, row));
    }

    async findByIdAndUpdate(id, update) {
        const existing = await this.findById(id);
        if (!existing) return null;

        const updated = applyUpdateObject(existing, update || {});
        updated._id = existing._id;
        if (!updated.createdAt) updated.createdAt = existing.createdAt || new Date().toISOString();
        if (!updated.updatedAt) updated.updatedAt = new Date().toISOString();

        if (!this._isSupabaseEnabled()) {
            const db = this._readDB();
            ensureLocalCollectionExists(db, this.collection);
            const index = db[this.collection].findIndex((item) => item._id === existing._id);
            if (index === -1) return null;
            db[this.collection][index] = updated;
            this._writeDB(db);
            return updated;
        }

        const payload = mapToDb(this.collection, updated);
        delete payload.id;

        const dbIdField = mapFieldToDb(this.collection, '_id');
        const { data, error } = await this.supabaseClient
            .from(this.collection)
            .update(payload)
            .eq(dbIdField, existing._id)
            .select('*')
            .limit(1);

        if (error) {
            throw new Error(`Supabase findByIdAndUpdate error (${this.collection}): ${error.message}`);
        }

        const row = Array.isArray(data) ? data[0] : null;
        return mapFromDb(this.collection, row);
    }

    async findOneAndUpdate(query, update, options = {}) {
        const matches = await this._readCollection(query || {});
        if (matches.length === 0) return null;

        const rawSort = options?.sort && typeof options.sort === 'object' ? options.sort : null;
        const normalizedSort = rawSort && Object.keys(rawSort).length === 1 && Object.prototype.hasOwnProperty.call(rawSort, '_id')
            ? { createdAt: rawSort._id }
            : rawSort;

        const sorted = normalizedSort ? sortItems(matches, normalizedSort) : matches;
        const first = sorted[0];
        if (!first?._id) return null;

        return this.findByIdAndUpdate(first._id, update || {});
    }

    async deleteMany(query = {}) {
        if (!this._isSupabaseEnabled()) {
            const db = this._readDB();
            ensureLocalCollectionExists(db, this.collection);
            const collection = Array.isArray(db[this.collection]) ? db[this.collection] : [];
            const remaining = collection.filter((item) => !matchesQuery(item, query));
            const deletedCount = collection.length - remaining.length;
            db[this.collection] = remaining;
            this._writeDB(db);
            return { deletedCount };
        }

        const matches = await this._readCollection(query);
        if (matches.length === 0) return { deletedCount: 0 };

        const ids = matches.map((item) => item._id).filter(Boolean);
        if (ids.length === 0) return { deletedCount: 0 };

        const dbIdField = mapFieldToDb(this.collection, '_id');
        const { error } = await this.supabaseClient
            .from(this.collection)
            .delete()
            .in(dbIdField, ids);

        if (error) {
            throw new Error(`Supabase deleteMany error (${this.collection}): ${error.message}`);
        }

        return { deletedCount: ids.length };
    }

    async deleteById(id) {
        const response = await this.deleteMany({ _id: String(id || '').trim() });
        return response.deletedCount > 0;
    }
}

module.exports = LocalDB;
