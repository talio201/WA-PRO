const DEFAULT_COUNTRY_CODE = '55';
const MIN_PHONE_LENGTH = 10;
const MAX_PHONE_LENGTH = 15;

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function formatNationalForSearch(nationalDigits) {
    if (nationalDigits.length === 11) {
        return `${nationalDigits.slice(0, 2)} ${nationalDigits.slice(2, 7)} ${nationalDigits.slice(7)}`;
    }

    if (nationalDigits.length === 10) {
        return `${nationalDigits.slice(0, 2)} ${nationalDigits.slice(2, 6)} ${nationalDigits.slice(6)}`;
    }

    return nationalDigits;
}

function buildSearchTerms(normalizedDigits, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
    const terms = new Set();

    if (!normalizedDigits) return [];

    terms.add(normalizedDigits);
    terms.add(`+${normalizedDigits}`);

    if (normalizedDigits.startsWith(defaultCountryCode) && normalizedDigits.length > defaultCountryCode.length) {
        const national = normalizedDigits.slice(defaultCountryCode.length);
        terms.add(national);
        terms.add(`${defaultCountryCode}${national}`);
        terms.add(`+${defaultCountryCode} ${formatNationalForSearch(national)}`);
        terms.add(`+${defaultCountryCode}${national}`);
    }

    return Array.from(terms).filter(Boolean);
}

function normalizePhone(rawPhone, options = {}) {
    const defaultCountryCode = String(options.defaultCountryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, '') || DEFAULT_COUNTRY_CODE;
    const raw = String(rawPhone || '').trim();
    let digits = digitsOnly(raw);

    if (!digits) {
        return {
            raw,
            normalized: '',
            isValid: false,
            reason: 'empty',
            searchTerms: [],
        };
    }

    if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }

    if ((digits.length === 10 || digits.length === 11 || digits.length === 12) && digits.startsWith('0')) {
        digits = digits.slice(1);
    }

    if (digits.length === 10 || digits.length === 11) {
        digits = `${defaultCountryCode}${digits}`;
    }

    const isValid = digits.length >= MIN_PHONE_LENGTH && digits.length <= MAX_PHONE_LENGTH;

    return {
        raw,
        normalized: digits,
        isValid,
        reason: isValid ? null : 'length_out_of_range',
        searchTerms: buildSearchTerms(digits, defaultCountryCode),
    };
}

module.exports = {
    normalizePhone,
    buildSearchTerms,
    digitsOnly,
};
