import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { createCampaign, generateMessageVariants, getMessages, uploadFile } from '../utils/api';

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

const dedupeContacts = (items = []) => {
    const map = new Map();

    items.forEach((item) => {
        const phone = normalizePhone(item.phone);
        if (!phone) return;

        if (!map.has(phone)) {
            map.set(phone, {
                phone,
                name: String(item.name || '').trim(),
            });
        }
    });

    return Array.from(map.values());
};

const parseManualContacts = (text) => {
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const contacts = [];

    lines.forEach((line) => {
        const commaChunks = line.split(',').map((chunk) => chunk.trim()).filter(Boolean);

        if (commaChunks.length === 0) return;

        if (commaChunks.length === 1) {
            const tokens = commaChunks[0].split(/[; ]+/).map((token) => token.trim()).filter(Boolean);
            tokens.forEach((token) => {
                const phone = normalizePhone(token);
                if (phone) contacts.push({ phone, name: '' });
            });
            return;
        }

        const first = commaChunks[0];
        const maybeName = commaChunks.slice(1).join(',').trim();
        const firstPhone = normalizePhone(first);
        const looksLikePhoneList = maybeName.length > 0 && !/[a-zA-Z]/.test(maybeName);

        if (looksLikePhoneList) {
            commaChunks.forEach((chunk) => {
                const phone = normalizePhone(chunk);
                if (phone) contacts.push({ phone, name: '' });
            });
            return;
        }

        if (firstPhone) {
            contacts.push({ phone: firstPhone, name: maybeName });
        }
    });

    return dedupeContacts(contacts);
};

const formatPhonePreview = (value) => {
    const phone = normalizePhone(value);
    if (!phone) return '+55 11 99999-9999';

    if (phone.length >= 13 && phone.startsWith('55')) {
        return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 9)}-${phone.slice(9, 13)}`;
    }

    if (phone.length >= 11) {
        return `+55 ${phone.slice(0, 2)} ${phone.slice(2, 7)}-${phone.slice(7, 11)}`;
    }

    return `+${phone}`;
};

const buildPreviewMessage = (template, name) => {
    const safeName = String(name || '').trim() || 'Cliente';
    const safeTemplate = String(template || '').trim();
    if (!safeTemplate) return 'Digite a mensagem para ver o preview.';
    return safeTemplate.replace(/{name}/g, safeName);
};

const NewCampaign = ({ onCancel }) => {
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const [source, setSource] = useState('manual');

    const [manualText, setManualText] = useState('');
    const [manualSelectedPhones, setManualSelectedPhones] = useState([]);

    const [excelFile, setExcelFile] = useState(null);
    const [excelContacts, setExcelContacts] = useState([]);
    const [excelSelectedPhones, setExcelSelectedPhones] = useState([]);

    const [dbContacts, setDbContacts] = useState([]);
    const [dbSearch, setDbSearch] = useState('');
    const [selectedDbContacts, setSelectedDbContacts] = useState([]);
    const [loadingDb, setLoadingDb] = useState(false);

    const [media, setMedia] = useState(null);
    const [uploadingMedia, setUploadingMedia] = useState(false);

    const [minDelaySeconds, setMinDelaySeconds] = useState(0);
    const [maxDelaySeconds, setMaxDelaySeconds] = useState(120);

    const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
    const [aiError, setAiError] = useState('');
    const [messageVariants, setMessageVariants] = useState([]);
    const [turboMode, setTurboMode] = useState(false);

    const manualContacts = useMemo(() => parseManualContacts(manualText), [manualText]);

    useEffect(() => {
        setManualSelectedPhones((current) => {
            const currentSet = new Set(current);
            const kept = manualContacts.filter((item) => currentSet.has(item.phone)).map((item) => item.phone);
            if (kept.length > 0) return kept;
            return manualContacts.map((item) => item.phone);
        });
    }, [manualContacts]);

    const selectedManualContacts = useMemo(() => (
        manualContacts.filter((item) => manualSelectedPhones.includes(item.phone))
    ), [manualContacts, manualSelectedPhones]);

    const selectedExcelContacts = useMemo(() => (
        excelContacts.filter((item) => excelSelectedPhones.includes(item.phone))
    ), [excelContacts, excelSelectedPhones]);

    const selectedContacts = useMemo(() => {
        if (source === 'manual') return selectedManualContacts;
        if (source === 'excel') return selectedExcelContacts;
        return selectedDbContacts;
    }, [source, selectedManualContacts, selectedExcelContacts, selectedDbContacts]);

    const canUseTurbo = messageVariants.length > 1;

    useEffect(() => {
        if (!canUseTurbo) setTurboMode(false);
    }, [canUseTurbo]);

    const loadDbContacts = useCallback(async () => {
        setLoadingDb(true);

        try {
            const logs = await getMessages({ limit: 5000 });
            const grouped = new Map();

            (logs || []).forEach((item) => {
                const phone = normalizePhone(item.phone);
                if (!phone || grouped.has(phone)) return;

                grouped.set(phone, {
                    phone,
                    name: String(item.name || item.phoneOriginal || '').trim(),
                });
            });

            setDbContacts(Array.from(grouped.values()));
        } catch (error) {
            console.error('Failed to load contacts from messages:', error);
        } finally {
            setLoadingDb(false);
        }
    }, []);

    useEffect(() => {
        if (source === 'database') {
            loadDbContacts();
        }
    }, [source, loadDbContacts]);

    const onDropExcel = useCallback((acceptedFiles) => {
        const file = acceptedFiles[0];
        if (!file) return;

        setExcelFile(file);
        const reader = new FileReader();

        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

            const parsed = rows
                .map((row) => ({
                    phone: normalizePhone(row?.[0]),
                    name: String(row?.[1] || '').trim(),
                }))
                .filter((item) => item.phone);

            const clean = dedupeContacts(parsed);
            setExcelContacts(clean);
            setExcelSelectedPhones(clean.map((item) => item.phone));
        };

        reader.readAsArrayBuffer(file);
    }, []);

    const onDropMedia = useCallback(async (acceptedFiles) => {
        const file = acceptedFiles[0];
        if (!file) return;

        setUploadingMedia(true);

        try {
            const result = await uploadFile(file);
            setMedia(result);
        } catch (error) {
            alert(`Erro ao enviar midia: ${error.message}`);
        } finally {
            setUploadingMedia(false);
        }
    }, []);

    const { getRootProps: getExcelRootProps, getInputProps: getExcelInputProps } = useDropzone({
        onDrop: onDropExcel,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
            'text/csv': ['.csv'],
        },
        maxFiles: 1,
    });

    const { getRootProps: getMediaRootProps, getInputProps: getMediaInputProps } = useDropzone({
        onDrop: onDropMedia,
        accept: {
            'image/*': [],
            'video/*': [],
            'audio/*': [],
        },
        maxFiles: 1,
    });

    const filteredDbContacts = useMemo(() => {
        const query = dbSearch.trim().toLowerCase();
        if (!query) return dbContacts;

        return dbContacts.filter((item) => (
            String(item.phone || '').toLowerCase().includes(query)
            || String(item.name || '').toLowerCase().includes(query)
        ));
    }, [dbContacts, dbSearch]);

    const previewContact = useMemo(() => {
        if (selectedContacts.length > 0) return selectedContacts[0];
        if (manualContacts.length > 0) return manualContacts[0];
        if (dbContacts.length > 0) return dbContacts[0];
        return { name: 'Cliente', phone: '5511999999999' };
    }, [selectedContacts, manualContacts, dbContacts]);

    const previewTemplate = useMemo(() => {
        if (turboMode && messageVariants.length > 0) return messageVariants[0];
        return message;
    }, [message, messageVariants, turboMode]);

    const previewMessage = useMemo(() => (
        buildPreviewMessage(previewTemplate, previewContact.name || 'Cliente')
    ), [previewTemplate, previewContact]);

    const handleGenerateVariants = async () => {
        const baseMessage = String(message || '').trim();
        setAiError('');

        if (!baseMessage) {
            setAiError('Digite uma mensagem antes de gerar as versoes.');
            return;
        }

        try {
            setIsGeneratingVariants(true);
            const payload = await generateMessageVariants({
                message: baseMessage,
                count: 5,
            });
            const variants = Array.isArray(payload?.variants) ? payload.variants : [];

            if (variants.length < 5) {
                throw new Error('Gemini retornou menos de 5 versões. Tente novamente.');
            }

            setMessageVariants(variants.slice(0, 5));
        } catch (error) {
            console.error('Gemini generation error:', error);
            setAiError(error.message || 'Não foi possível gerar versões com Gemini.');
        } finally {
            setIsGeneratingVariants(false);
        }
    };

    const parsedMinDelay = Number(minDelaySeconds);
    const parsedMaxDelay = Number(maxDelaySeconds);
    const isAntiBanInvalid = (
        !Number.isFinite(parsedMinDelay)
        || !Number.isFinite(parsedMaxDelay)
        || parsedMinDelay < 0
        || parsedMaxDelay < 0
        || parsedMinDelay > parsedMaxDelay
    );

    const handleSubmit = async () => {
        const campaignName = String(name || '').trim();
        const finalContacts = dedupeContacts(selectedContacts);
        const cleanMessage = String(message || '').trim();

        if (!campaignName) return alert('Informe o nome da campanha.');
        if (finalContacts.length === 0) return alert('Selecione ao menos um contato.');
        if (!cleanMessage && !media) return alert('Informe uma mensagem ou anexe uma midia.');
        if (isAntiBanInvalid) return alert('Revise os tempos do Anti-Ban.');
        if (turboMode && !canUseTurbo) return alert('Turbo Mode precisa de ao menos 2 versões de mensagem.');

        try {
            await createCampaign({
                name: campaignName,
                messageTemplate: message,
                messageVariants,
                turboMode: turboMode && canUseTurbo,
                contacts: finalContacts,
                media,
                antiBan: {
                    minDelaySeconds: parsedMinDelay,
                    maxDelaySeconds: parsedMaxDelay,
                },
            });

            alert('Campanha criada com sucesso.');
            onCancel();
        } catch (error) {
            alert(`Erro ao criar campanha: ${error.message}`);
        }
    };

    const sourceOptions = [
        { id: 'manual', label: 'Manual' },
        { id: 'excel', label: 'Excel / CSV' },
        { id: 'database', label: 'Banco' },
    ];

    const previewTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="new-campaign-page mx-auto max-w-[1460px] text-slate-900">
            <div className="new-campaign-shell relative overflow-hidden rounded-[30px] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)]">
                <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl" />

                <div className="relative grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_420px]">
                    <section className="new-campaign-main space-y-8 p-7 xl:p-10">
                        <header className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Campaign Studio</p>
                                <h2 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">Nova Campanha</h2>
                                <p className="mt-2 text-base text-slate-600">Fluxo único e intuitivo para montar, variar e disparar sua campanha.</p>
                            </div>
                            <button
                                type="button"
                                onClick={onCancel}
                                className="new-campaign-btn-secondary rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            >
                                Cancelar
                            </button>
                        </header>

                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_130px_130px_130px]">
                            <div>
                                <label className="mb-2 block text-sm font-semibold text-slate-700">Nome da campanha</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder="Ex: Oferta de Maio"
                                    className="new-campaign-input w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                />
                            </div>
                            <div className="new-campaign-kpi rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <p className="text-xs font-medium uppercase text-slate-500">Contatos</p>
                                <p className="mt-1 text-2xl font-bold text-slate-900">{selectedContacts.length}</p>
                            </div>
                            <div className="new-campaign-kpi rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <p className="text-xs font-medium uppercase text-slate-500">Versões IA</p>
                                <p className="mt-1 text-2xl font-bold text-slate-900">{messageVariants.length}</p>
                            </div>
                            <div className="new-campaign-kpi rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <p className="text-xs font-medium uppercase text-slate-500">Turbo</p>
                                <p className={`mt-1 text-2xl font-bold ${turboMode ? 'text-emerald-700' : 'text-slate-900'}`}>{turboMode ? 'ON' : 'OFF'}</p>
                            </div>
                        </div>

                        <div className="new-campaign-surface space-y-4 rounded-2xl border border-slate-200 bg-white/90 p-5">
                            <div className="flex items-center justify-between">
                                <label className="text-lg font-semibold text-slate-900">Mensagem principal</label>
                                <span className="text-sm text-slate-500">{message.length} caracteres</span>
                            </div>

                            <textarea
                                value={message}
                                onChange={(event) => setMessage(event.target.value)}
                                placeholder="Olá {name}, temos uma condição especial para você..."
                                className="new-campaign-input h-56 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-base leading-relaxed outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            />

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={handleGenerateVariants}
                                    disabled={isGeneratingVariants}
                                    className={`new-campaign-btn-primary rounded-xl px-5 py-3 text-sm font-semibold text-white ${isGeneratingVariants ? 'cursor-not-allowed bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                                >
                                    {isGeneratingVariants ? 'Gerando...' : 'Gerar 5 versões'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTurboMode((value) => !value)}
                                    disabled={!canUseTurbo}
                                    className={`new-campaign-btn-secondary rounded-xl px-4 py-3 text-sm font-semibold ${turboMode ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'} ${!canUseTurbo ? 'cursor-not-allowed opacity-50' : ''}`}
                                >
                                    Turbo {turboMode ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <p className="text-xs text-slate-500">
                                Chave Gemini no servidor: configure em <code>backend/.env</code> com <code>GEMINI_API_KEY</code>.
                            </p>

                            {aiError && <p className="text-sm font-medium text-red-600">{aiError}</p>}

                            {messageVariants.length > 0 && (
                                <div className="grid gap-2 md:grid-cols-2">
                                    {messageVariants.map((variant, index) => (
                                        <div key={`${index}-${variant.slice(0, 10)}`} className="new-campaign-variant rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Versão {index + 1}</p>
                                            <p className="mt-1 text-sm text-slate-700">{variant}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                            <div className="new-campaign-surface rounded-2xl border border-slate-200 bg-white p-5">
                                <div className="mb-3 flex flex-wrap gap-2">
                                    {sourceOptions.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => setSource(option.id)}
                                            className={`new-campaign-source-chip rounded-full px-4 py-2 text-sm font-semibold ${source === option.id ? 'bg-emerald-600 text-white new-campaign-source-chip--active' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>

                                {source === 'manual' && (
                                    <>
                                        <textarea
                                            value={manualText}
                                            onChange={(event) => setManualText(event.target.value)}
                                            placeholder="5511999999999,João\n5511888888888,Maria"
                                            className="new-campaign-input h-28 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                        />
                                        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                                            <span>{manualContacts.length} contato(s)</span>
                                            <div className="space-x-3">
                                                <button type="button" onClick={() => setManualSelectedPhones(manualContacts.map((item) => item.phone))} className="new-campaign-link-btn font-semibold text-emerald-700">Selecionar todos</button>
                                                <button type="button" onClick={() => setManualSelectedPhones([])} className="new-campaign-link-btn font-semibold text-slate-500">Limpar</button>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {source === 'excel' && (
                                    <>
                                        <div
                                            {...getExcelRootProps()}
                                            className="new-campaign-dropzone flex min-h-[110px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 text-center text-sm text-slate-600 hover:border-emerald-500"
                                        >
                                            <input {...getExcelInputProps()} />
                                            {excelFile ? `Arquivo: ${excelFile.name}` : 'Arraste ou clique para importar Excel/CSV'}
                                        </div>
                                        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                                            <span>{excelContacts.length} contato(s) importado(s)</span>
                                            <div className="space-x-3">
                                                <button type="button" onClick={() => setExcelSelectedPhones(excelContacts.map((item) => item.phone))} className="new-campaign-link-btn font-semibold text-emerald-700">Selecionar todos</button>
                                                <button type="button" onClick={() => setExcelSelectedPhones([])} className="new-campaign-link-btn font-semibold text-slate-500">Limpar</button>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {source === 'database' && (
                                    <>
                                        <input
                                            type="text"
                                            value={dbSearch}
                                            onChange={(event) => setDbSearch(event.target.value)}
                                            placeholder="Buscar por nome ou número"
                                            className="new-campaign-input w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                        />
                                        {loadingDb && <p className="mt-3 text-sm text-slate-500">Carregando contatos...</p>}
                                    </>
                                )}

                                <details className="new-campaign-details mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Selecionar contatos</summary>
                                    <div className="mt-3 space-y-2">
                                        {source === 'manual' && manualContacts.map((contact) => (
                                            <label key={`m-${contact.phone}`} className="new-campaign-contact-row flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={manualSelectedPhones.includes(contact.phone)}
                                                    onChange={(event) => {
                                                        const checked = event.target.checked;
                                                        setManualSelectedPhones((current) => checked ? [...current, contact.phone] : current.filter((phone) => phone !== contact.phone));
                                                    }}
                                                />
                                                <span className="font-mono text-slate-700">{contact.phone}</span>
                                                <span className="text-slate-500">{contact.name || '-'}</span>
                                            </label>
                                        ))}

                                        {source === 'excel' && excelContacts.map((contact) => (
                                            <label key={`e-${contact.phone}`} className="new-campaign-contact-row flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={excelSelectedPhones.includes(contact.phone)}
                                                    onChange={(event) => {
                                                        const checked = event.target.checked;
                                                        setExcelSelectedPhones((current) => checked ? [...current, contact.phone] : current.filter((phone) => phone !== contact.phone));
                                                    }}
                                                />
                                                <span className="font-mono text-slate-700">{contact.phone}</span>
                                                <span className="text-slate-500">{contact.name || '-'}</span>
                                            </label>
                                        ))}

                                        {source === 'database' && filteredDbContacts.map((contact) => (
                                            <label key={`d-${contact.phone}`} className="new-campaign-contact-row flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedDbContacts.some((item) => item.phone === contact.phone)}
                                                    onChange={(event) => {
                                                        const checked = event.target.checked;
                                                        setSelectedDbContacts((current) => checked ? [...current, contact] : current.filter((item) => item.phone !== contact.phone));
                                                    }}
                                                />
                                                <span className="font-mono text-slate-700">{contact.phone}</span>
                                                <span className="text-slate-500">{contact.name || '-'}</span>
                                            </label>
                                        ))}
                                    </div>
                                </details>
                            </div>

                            <div className="new-campaign-surface rounded-2xl border border-slate-200 bg-white p-5">
                                <p className="mb-2 text-sm font-semibold text-slate-700">Mídia (opcional)</p>
                                <div
                                    {...getMediaRootProps()}
                                    className="new-campaign-dropzone flex min-h-[200px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 text-center text-sm text-slate-600 hover:border-emerald-500"
                                >
                                    <input {...getMediaInputProps()} />
                                    {uploadingMedia ? 'Enviando mídia...' : media ? `Arquivo: ${media.fileName}` : 'Clique ou arraste imagem / vídeo / áudio'}
                                </div>
                            </div>
                        </div>
                    </section>

                    <aside className="new-campaign-preview-pane border-l border-slate-200/80 bg-white/70 p-7 backdrop-blur xl:p-8">
                        <div className="space-y-6 xl:sticky xl:top-24">
                            <div>
                                <p className="text-lg font-semibold text-slate-900">Live Preview</p>
                                <p className="text-sm text-slate-500">Como a mensagem chega no WhatsApp</p>
                            </div>

                            <div className="mx-auto w-[360px] rounded-[2.3rem] border-[10px] border-slate-900 bg-black p-2 shadow-2xl">
                                <div className="flex h-[730px] flex-col overflow-hidden rounded-[1.7rem] bg-[#e5ddd5]">
                                    <div className="flex items-center justify-between bg-[#075E54] px-4 py-3 text-white">
                                        <div className="min-w-0">
                                            <p className="truncate text-base font-semibold">{previewContact.name || 'Cliente'}</p>
                                            <p className="truncate text-xs text-emerald-100">{formatPhonePreview(previewContact.phone)}</p>
                                        </div>
                                        <span className="text-xs text-emerald-100">online</span>
                                    </div>

                                    <div className="flex-1 space-y-3 overflow-y-auto p-4">
                                        {media?.mimetype?.startsWith('image') && (
                                            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white p-1 shadow">
                                                <img src={media.fileUrl} alt="preview" className="max-h-48 w-full rounded object-contain" />
                                            </div>
                                        )}

                                        {media && !media?.mimetype?.startsWith('image') && (
                                            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-slate-700 shadow">
                                                Mídia: {media.fileName}
                                            </div>
                                        )}

                                        <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-slate-800 shadow">
                                            <p className="whitespace-pre-wrap break-words">{previewMessage}</p>
                                            <div className="mt-1 text-right text-[11px] text-slate-500">{previewTime}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="new-campaign-surface rounded-2xl border border-slate-200 bg-white p-4">
                                <p className="text-sm font-semibold text-slate-700">Anti-ban</p>
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs text-slate-500">Mínimo (s)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={minDelaySeconds}
                                            onChange={(event) => setMinDelaySeconds(event.target.value)}
                                            className="new-campaign-input w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs text-slate-500">Máximo (s)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={maxDelaySeconds}
                                            onChange={(event) => setMaxDelaySeconds(event.target.value)}
                                            className="new-campaign-input w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                        />
                                    </div>
                                </div>
                                {isAntiBanInvalid && <p className="mt-2 text-sm font-medium text-red-600">O mínimo não pode ser maior que o máximo.</p>}
                            </div>

                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isAntiBanInvalid}
                                className={`new-campaign-btn-primary new-campaign-btn-submit w-full rounded-2xl px-6 py-4 text-base font-bold text-white ${isAntiBanInvalid ? 'cursor-not-allowed bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                            >
                                Criar e iniciar campanha
                            </button>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default NewCampaign;

