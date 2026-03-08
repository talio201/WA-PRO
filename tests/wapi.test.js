
const fs = require('fs');
const path = require('path');

// Read the WAPI file content
// We need to eval it because it's designed to run in the browser console, not as a module
const wapiContent = fs.readFileSync(path.resolve(__dirname, '../js/wapi.js'), 'utf8');

describe('WAPI Unit Tests', () => {
    let originalWindow;

    beforeEach(() => {
        jest.useFakeTimers();
        // Save original window if needed (jest-environment-jsdom provides a window)
        originalWindow = global.window;
        
        // Reset window state
        window.WAPI = undefined;
        window.Store = undefined;
        // Mock the webpack chunk array so start() doesn't crash.
        window.webpackChunkwhatsapp_web_client = [];
        window.webpackChunkwhatsapp_web_client.push = jest.fn();
        window.require = undefined;
        window.importNamespace = undefined;
        
        // Mock console to keep output clean, but allow errors
        console.log = jest.fn();
        console.warn = jest.fn();
        // console.error = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('WAPI should expose core helpers', () => {
        eval(wapiContent);
        expect(window.WAPI).toBeDefined();
        expect(typeof window.WAPI._digits).toBe('function');
        expect(typeof window.WAPI._extractLikelyNumberDigits).toBe('function');

        expect(window.WAPI._digits('+55 (11) 99999-8888')).toBe('5511999998888');
        expect(window.WAPI._extractLikelyNumberDigits('foo 5511999999999 bar')).toBe('5511999999999');
    });

    test('WAPI.listContacts should return formatted contacts', () => {
        eval(wapiContent);
        
        // Manually setup Store.Contact for deterministic test.
        const mockContact = {
            id: { _serialized: "5511999999999@c.us", user: "5511999999999", server: 'c.us' },
            name: "John Doe",
            pushname: "John",
            formattedName: "John Doe",
            isMyContact: true,
            isWAContact: true,
            isUser: true,
            isGroup: false,
            isBusiness: false,
            profilePicThumbObj: { eurl: 'https://example.com/avatar.png' }
        };

        window.Store = {
            Contact: {
                models: [mockContact]
            }
        };

        // Run listContacts
        const contacts = window.WAPI.listContacts(true);

        // Assertions
        expect(contacts).toHaveLength(1);
        expect(contacts[0].id).toBe("5511999999999@c.us");
        expect(contacts[0].name).toBe("John Doe");
        expect(contacts[0].isUser).toBe(true);
        expect(contacts[0].avatar).toBe('https://example.com/avatar.png');
    });

    test('openChat should open existing contact via search before new conversation', async () => {
        eval(wapiContent);
        jest.spyOn(window.WAPI, '_delay').mockResolvedValue(undefined);

        const searchSpy = jest.spyOn(window.WAPI, '_trySearchAndOpen').mockResolvedValue(true);
        const newConvSpy = jest.spyOn(window.WAPI, '_openNewConversation').mockResolvedValue(false);
        const validateSpy = jest.spyOn(window.WAPI, '_validateActiveChat')
            .mockReturnValueOnce(false) // fast-path initial check
            .mockReturnValueOnce(true); // after search

        const result = await window.WAPI.openChat('5511999999999@c.us', 'Contato Teste');

        expect(result).toBe(true);
        expect(searchSpy).toHaveBeenCalled();
        expect(newConvSpy).not.toHaveBeenCalled();
        expect(validateSpy).toHaveBeenCalled();
    });

    test('openChat should fallback to new conversation when search does not find contact', async () => {
        eval(wapiContent);
        jest.spyOn(window.WAPI, '_delay').mockResolvedValue(undefined);

        const searchSpy = jest.spyOn(window.WAPI, '_trySearchAndOpen').mockResolvedValue(false);
        const newConvSpy = jest.spyOn(window.WAPI, '_openNewConversation').mockResolvedValue(true);
        const validateSpy = jest.spyOn(window.WAPI, '_validateActiveChat')
            .mockReturnValueOnce(false) // fast-path initial check
            .mockReturnValueOnce(true); // after new conversation

        const result = await window.WAPI.openChat('5511888887777@c.us', 'Lead Manual');

        expect(result).toBe(true);
        expect(searchSpy).toHaveBeenCalled();
        expect(newConvSpy).toHaveBeenCalledWith('5511888887777', { allowMismatch: false });
        expect(validateSpy).toHaveBeenCalled();
    });

    test('openChat should throw CHAT_MISMATCH if opened chat differs from expected number', async () => {
        eval(wapiContent);
        jest.spyOn(window.WAPI, '_delay').mockResolvedValue(undefined);

        jest.spyOn(window.WAPI, '_trySearchAndOpen').mockResolvedValue(false);
        jest.spyOn(window.WAPI, '_openNewConversation').mockResolvedValue(true);
        jest.spyOn(window.WAPI, '_validateActiveChat')
            .mockReturnValueOnce(false) // fast-path initial check
            .mockReturnValueOnce(false); // validation after open
        jest.spyOn(window.WAPI, '_getActiveChatJidFromDom').mockReturnValue('5511777770000@c.us');
        jest.spyOn(window.WAPI, '_getActiveHeaderNumberDigits').mockReturnValue('5511777770000');

        await expect(window.WAPI.openChat('5511666669999@c.us', 'Contato Errado'))
            .rejects
            .toThrow('CHAT_MISMATCH expected=5511666669999 got=5511777770000');
    });

    test('sendTextMessage should allow compose-only flow for unsaved number when recent open is trusted', async () => {
        eval(wapiContent);
        jest.spyOn(window.WAPI, '_randomDelay').mockResolvedValue(undefined);
        jest.spyOn(window.WAPI, '_delay').mockResolvedValue(undefined);
        jest.spyOn(window.WAPI, 'openChat').mockResolvedValue(true);
        jest.spyOn(window.WAPI, '_getComposeBox').mockReturnValue({});
        jest.spyOn(window.WAPI, '_getActiveChatJidFromDom').mockReturnValue('');
        jest.spyOn(window.WAPI, '_getActiveHeaderNumberDigits').mockReturnValue('');
        jest.spyOn(window.WAPI, '_detectInvalidNumberPage').mockReturnValue(false);
        jest.spyOn(window.WAPI, '_canTrustComposeFor').mockReturnValue(true);
        const typeSpy = jest.spyOn(window.WAPI, '_typeInComposeBox').mockResolvedValue(true);
        const sendSpy = jest.spyOn(window.WAPI, '_clickSend').mockResolvedValue(true);

        const result = await window.WAPI.sendTextMessage('5511999999999@c.us', 'Teste', 'Lead Manual');

        expect(result).toEqual({ success: true });
        expect(typeSpy).toHaveBeenCalledWith('Teste');
        expect(sendSpy).toHaveBeenCalled();
    });
});
