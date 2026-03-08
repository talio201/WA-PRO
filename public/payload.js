console.log('WAPI: Initializing...');

window.WAPI = {
    _db: undefined,
    lastRead: {},
    postMessage: (payload) => {
        window.postMessage({ type: 'FROM_WAPI', payload: payload }, '*');
    }
};

/**
 * Universal Module Finder and Store Extractor
 */
function initializeWAPI() {
    console.log('WAPI: Initializing WAPI methods...');

    // Validate if we have a loader
    if (!window.webpackRequire) {
        if (typeof window.importNamespace === 'function') {
            window.webpackRequire = (id) => {
                try { return window.importNamespace(id); } catch (e) { return null; }
            };
        } else {
            console.warn('WAPI: No loader (webpackRequire/importNamespace) found yet.');
            return;
        }
    }

    // 1. Module Discovery Helper
    const findModule = (filter) => {
        // A. Try standard webpackRequire.m (if we captured it)
        if (window.webpackRequire.m) {
            for (let id in window.webpackRequire.m) {
                try {
                    let mod = window.webpackRequire(id);
                    if (mod && filter(mod)) return mod;
                    if (mod && mod.default && filter(mod.default)) return mod.default;
                } catch (e) { }
            }
        }

        // B. Try Scraped Modules (from Passive Scan)
        if (window.scrapedModules && Object.keys(window.scrapedModules).length > 0) {
            for (let id in window.scrapedModules) {
                try {
                    let mod = window.webpackRequire(id);
                    if (mod && filter(mod)) return mod;
                    if (mod && mod.default && filter(mod.default)) return mod.default;
                } catch (e) { }
            }
        }

        return null;
    };

    // 2. Find Store
    const signature = (mod) => mod.Chat && mod.Contact && mod.Msg;
    let Store = findModule(signature);

    // 3. Brute Force Fallback (if standard finding failed)
    if (!Store) {
        console.log('WAPI: Standard scan failed. Starting BRUTE FORCE scan (0-50000)...');
        const start = Date.now();
        for (let i = 0; i < 50000; i++) {
            try {
                const mod = window.webpackRequire(i);
                if (mod) {
                    if (signature(mod) || (mod.default && signature(mod.default))) {
                        console.log(`WAPI: FOUND Store at ID: ${i}`);
                        Store = mod.default || mod;
                        break;
                    }
                }
            } catch (e) { }
        }
        console.log(`WAPI: Brute force complete in ${(Date.now() - start)}ms`);
    }

    if (Store) {
        console.log('WAPI: Store module found!', Store);
        window.Store = Store;
    } else {
        console.warn('WAPI: Store NOT found even after brute force.');
    }

    // 4. Define Methods
    window.WAPI.getContacts = function () {
        if (!window.Store || !window.Store.Contact) {
            console.error('WAPI: Store.Contact not available');
            return [];
        }
        const contacts = window.Store.Contact.models || window.Store.Contact.getModelsArray();
        return contacts.map(c => ({
            id: c.id._serialized,
            name: c.name || c.pushname || c.formattedName,
            number: c.userid,
            isBusiness: c.isBusiness,
            isMyContact: c.isMyContact
        }));
    };

    // 5. Notify Readiness
    if (window.Store && window.Store.Contact) {
        console.log('WAPI: AVAILABLE and READY. Run WAPI.getContacts()');
        window.WAPI.postMessage({ type: 'WAPI_READY', status: 'ready' });
    } else {
        console.log('WAPI: Not ready. Store missing.');
    }
}


// --- INJECTION & EXTRACTION ---

function scrapeWebpackChunk() {
    try {
        const chunkName = 'webpackChunkwhatsapp_web_client';
        const chunk = window[chunkName];
        if (Array.isArray(chunk)) {
            console.log('WAPI: Passive Scan - Scraping existing webpack chunk...');
            window.scrapedModules = {};
            chunk.forEach(subChunk => {
                if (subChunk.length >= 2 && typeof subChunk[1] === 'object') {
                    Object.assign(window.scrapedModules, subChunk[1]);
                }
            });
            console.log(`WAPI: Scraped ${Object.keys(window.scrapedModules).length} module definitions.`);
        } else {
            console.warn('WAPI: webpackChunkwhatsapp_web_client is NOT an array or undefined.', typeof chunk);
        }
    } catch (e) {
        console.error('WAPI: Passive scan failed', e);
    }
}

function start() {
    console.log('WAPI: Starting injection...');

    // 1. Passive Scan
    scrapeWebpackChunk();

    // 2. Try Webpack Push
    if (window.webpackChunkwhatsapp_web_client && Array.isArray(window.webpackChunkwhatsapp_web_client)) {
        window.webpackChunkwhatsapp_web_client.push([
            [Date.now()],
            {},
            function (r) {
                console.log('WAPI: Webpack require captured!');
                window.webpackRequire = r;
                initializeWAPI();
            }
        ]);
    } else {
        // 3. Fallback to Meta ImportNamespace
        if (typeof window.importNamespace === 'function') {
            console.log('WAPI: Using importNamespace as require...');
            if (!window.webpackRequire) {
                window.webpackRequire = (id) => {
                    try { return window.importNamespace(id); } catch (e) { return null; }
                };
            }
            // Give it a moment to stabilize then init
            setTimeout(initializeWAPI, 1000);
        } else {
            console.error('WAPI: No viable module loader found (No webpackChunk, no importNamespace).');
            // Try brute force anyway check global window.require
            if (window.require) {
                window.webpackRequire = window.require;
                initializeWAPI();
            }
        }
    }
}

start();

window.addEventListener("message", function (event) {
    if (event.data.type === "FROM_EXTENSION") {
        if (event.data.data && event.data.data.action === "get_contacts") {
            if (window.WAPI.getContacts) {
                window.WAPI.postMessage({ action: "contacts_list", data: window.WAPI.getContacts() });
            }
        }
    }
});