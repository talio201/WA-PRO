import React, { useState, useEffect, useRef } from "react";
import {
  getContacts,
  addContact,
  deleteContact,
  importContactsCsv,
  getLeadAnalytics,
  updateContactCrm,
} from "../utils/api.js";
import { connectRealtime } from '../utils/realtime.js';
import { UserGroupIcon, ArrowUpTrayIcon, PlusIcon, TrashIcon, MagnifyingGlassIcon, ExclamationTriangleIcon, PhoneIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const CONTACTS_FALLBACK_REFRESH_INTERVAL_MS = 60000;

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [leadAnalytics, setLeadAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState("");
  const [leadDraft, setLeadDraft] = useState({
    stage: "new",
    score: 0,
    owner: "",
    nextActionAt: "",
    tags: "",
    notes: "",
  });

  const fileInputRef = useRef(null);
  const agentId = localStorage.getItem("emidia_agent_id") || "agent-unknown";

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const [data, analytics] = await Promise.all([
        getContacts(),
        getLeadAnalytics().catch(() => null),
      ]);
      setContacts(Array.isArray(data) ? data : []);
      setLeadAnalytics(analytics || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  useEffect(() => {
    const disposeRealtime = connectRealtime({
      onEvent: (message) => {
        const eventName = String(message?.event || '');
        const shouldReload = eventName.startsWith('contacts.')
          || eventName.startsWith('messages.')
          || eventName.startsWith('campaign.')
          || eventName === 'upload.completed';
        if (shouldReload) {
          fetchContacts();
        }
      },
    });

    const interval = setInterval(() => {
      fetchContacts();
    }, CONTACTS_FALLBACK_REFRESH_INTERVAL_MS);

    return () => {
      disposeRealtime();
      clearInterval(interval);
    };
  }, []);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!phoneInput) {
       setError("Telefone e obrigatorio.");
       return;
    }
    try {
      await addContact({ name: nameInput, phone: phoneInput });
      setNameInput("");
      setPhoneInput("");
      fetchContacts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      setImporting(true);
      setError(null);
      const result = await importContactsCsv(file);
      alert(`Importacao concluida! ${result.imported} contatos adicionados e ${result.ignored_duplicates || 0} duplicados ignorados.`);
      fetchContacts();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Certeza que deseja remover este contato?")) return;
    try {
      await deleteContact(id);
      fetchContacts();
    } catch (err) {
      alert("Erro ao remover: " + err.message);
    }
  };

  const openLeadEditor = (contact) => {
    const crm = contact?.crm || {};
    const nextActionAt = crm.nextActionAt
      ? new Date(crm.nextActionAt).toISOString().slice(0, 16)
      : "";
    setEditingLeadId(contact._id);
    setLeadDraft({
      stage: crm.stage || "new",
      score: Number(crm.score || 0),
      owner: crm.owner || "",
      nextActionAt,
      tags: Array.isArray(crm.tags) ? crm.tags.join(", ") : "",
      notes: crm.notes || "",
    });
  };

  const saveLeadEditor = async (contactId) => {
    try {
      await updateContactCrm(contactId, {
        stage: leadDraft.stage,
        score: Number(leadDraft.score || 0),
        owner: leadDraft.owner,
        tags: String(leadDraft.tags || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        notes: leadDraft.notes,
        nextActionAt: leadDraft.nextActionAt
          ? new Date(leadDraft.nextActionAt).toISOString()
          : null,
      });
      setEditingLeadId("");
      await fetchContacts();
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const query = search.toLowerCase();
    const matchesName = (c.name || "").toLowerCase().includes(query);
    const matchesPhone = (c.phone || "").toLowerCase().includes(query);
    return matchesName || matchesPhone;
  });

  return (
    <div className="crm-contacts flex flex-col flex-1 h-full w-full min-h-0 p-4 md:p-6 gap-6 rounded-2xl relative overflow-hidden">
      
      {/* HEADER COMPLETO RICH AESTHETICS */}
      <div className="crm-panel flex flex-col xl:flex-row items-start justify-between gap-4 md:gap-6 p-4 md:p-6 lg:px-8 rounded-3xl backdrop-blur-md relative w-full shrink-0 min-h-[112px]">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-teal-500/10 rounded-full blur-3xl -ml-20 -mb-20 pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row items-start gap-4 z-10 w-full">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-500 p-3 rounded-2xl shadow-lg shadow-emerald-500/20">
            <UserGroupIcon className="w-8 h-8 text-white" />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <h2 className="text-3xl font-extrabold bg-gradient-to-r from-emerald-700 to-cyan-700 bg-clip-text text-transparent break-words">Minha Agenda</h2>
            <div className="flex items-center gap-2 mt-1.5 opacity-80">
               <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
               <p className="text-sm tracking-wide text-slate-600">Agenda Pessoal Segura</p>
            </div>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed break-words">Gerencie os contatos isolados deste navegador. Nenhuma outra máquina tem acesso a esses dados.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto mt-4 md:mt-0 z-10 flex-shrink-0">
           <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleImport} 
           />
           <button 
             onClick={() => fileInputRef.current?.click()}
             disabled={importing}
             className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-3 rounded-2xl font-semibold transition-all shadow-lg shadow-emerald-900/40 hover:shadow-emerald-900/60 disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0"
           >
             <ArrowUpTrayIcon className={`w-5 h-5 ${importing ? "animate-bounce" : ""}`} />
             {importing ? "Lendo CSV..." : "Importar CSV"}
           </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3.5 rounded-2xl flex items-center gap-3 backdrop-blur-sm animate-in fade-in slide-in-from-top-4">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 w-full">
        {(leadAnalytics ? [
          { key: 'totalLeads', label: 'Leads', value: leadAnalytics.totalLeads || 0, style: 'text-white' },
          { key: 'new', label: 'Novos', value: leadAnalytics?.byStage?.new || 0, style: 'text-cyan-300' },
          { key: 'qualified', label: 'Qualificados', value: leadAnalytics?.byStage?.qualified || 0, style: 'text-emerald-300' },
          { key: 'proposal', label: 'Proposta', value: leadAnalytics?.byStage?.proposal || 0, style: 'text-amber-300' },
          { key: 'won', label: 'Ganhos', value: leadAnalytics?.byStage?.won || 0, style: 'text-emerald-400' },
          { key: 'conversion', label: 'Conversão', value: (leadAnalytics?.conversion?.wonRate || 0) + '%', style: 'text-white' },
        ] : Array.from({ length: 6 }).map((_, i) => ({ skeleton: true, key: 's' + i }))).map((item, idx) => (
          <div key={item.key || idx} className="crm-kpi rounded-2xl px-4 py-3 min-h-[72px] flex flex-col justify-center">
            {item.skeleton ? (
              <div className="animate-pulse">
                <div className="h-3 bg-slate-700 rounded w-24 mb-2"></div>
                <div className="h-6 bg-slate-700 rounded w-16"></div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">{item.label}</p>
                <p className={`text-2xl font-bold ${item.style}`}>{item.value}</p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full max-w-full">
        
        {/* COLUNA ESQUERDA: NOVO CONTATO MANUAL */}
        <div className="crm-panel lg:col-span-1 p-4 md:p-6 rounded-3xl backdrop-blur-sm flex flex-col h-fit min-w-0 w-full overflow-hidden">
          <h3 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
            <PlusIcon className="w-5 h-5 text-emerald-400 bg-emerald-400/10 p-1.5 box-content rounded-lg" />
            Adicionar Manual
          </h3>
          <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-sm text-slate-400 pl-1">Nome (Opcional)</label>
              <input 
                type="text" 
                placeholder="Ex: Joao da Silva"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="crm-input w-full rounded-xl px-4 py-3 transition-all"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-sm text-slate-400 pl-1">Telefone / WhatsApp</label>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Ex: 5511999999999"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="crm-input w-full rounded-xl pl-10 pr-4 py-3 transition-all font-mono tracking-wide"
                />
                <PhoneIcon className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button type="submit" className="crm-primary-btn mt-2 px-6 py-3 rounded-xl font-medium transition-colors">
              Salvar Contato
            </button>
          </form>
        </div>

        {/* COLUNA DIREITA: LISTA COM BUSCA */}
        <div className="crm-panel lg:col-span-2 rounded-3xl flex flex-col overflow-hidden backdrop-blur-sm min-w-0 w-full">
          <div className="p-5 md:p-6 border-b border-slate-200/70 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/85">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-slate-900">Listagem Completa</h3>
              <span className="bg-emerald-50 text-emerald-700 text-xs px-3 py-1 rounded-full border border-emerald-200 font-medium">
                {filteredContacts.length} salvos
              </span>
            </div>
            
            <div className="relative w-full md:w-64 group">
              <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 group-focus-within:text-emerald-400 transition-colors" />
              <input
                 type="text"
                 placeholder="Buscar por nome ou numero..."
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 className="crm-input w-full rounded-xl pl-10 pr-4 py-2 text-sm transition-all"
              />
            </div>
          </div>
          
          <div className="p-4 md:p-6 flex-1 overflow-y-auto max-h-[500px] scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400">
                <ArrowPathIcon className="w-8 h-8 animate-spin text-emerald-500 mb-4 opacity-80" />
                <p>Sincronizando contatos com o banco seguro...</p>
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-500 text-center px-4">
                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700">
                  <UserGroupIcon className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-lg text-slate-300 font-medium mb-1">Nenhum contato encontrado</p>
                <p className="max-w-xs">{search ? "Altere os termos de busca para encontrar." : "Adicione manualmente ou importe uma planilha Excel para comecar."}</p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredContacts.map((contact) => (
                  <li key={contact._id} className="crm-card p-4 rounded-2xl flex items-center justify-between group transition-all duration-300 hover:shadow-lg hover:shadow-emerald-900/10 hover:-translate-y-0.5">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-slate-600/50 shrink-0 shadow-inner text-slate-300 font-medium uppercase">
                        {(contact.name ? contact.name[0] : '#')}
                      </div>
                      <div className="overflow-hidden">
                        <div className="text-slate-200 font-medium truncate" title={contact.name || "Sem Nome"}>
                          {contact.name || <span className="text-slate-500 italic">Sem Nome</span>}
                        </div>
                        <div className="text-sm text-emerald-400 tracking-wider font-mono mt-0.5 truncate">{contact.phone}</div>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-slate-700">
                            {String(contact?.crm?.stage || "new").toUpperCase()}
                          </span>
                          <span className="text-slate-400">Score {Number(contact?.crm?.score || 0)}</span>
                        </div>
                        {contact?.crm?.nextActionAt && (
                          <div className="text-[11px] text-amber-300 mt-1 truncate">
                            Proxima acao: {new Date(contact.crm.nextActionAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openLeadEditor(contact)}
                        className="px-2.5 py-1.5 text-[11px] text-cyan-300 hover:bg-cyan-500/10 rounded-lg border border-cyan-600/30 transition-all opacity-0 group-hover:opacity-100"
                        title="Editar CRM do lead"
                      >
                        CRM
                      </button>
                      <button 
                        onClick={() => handleDelete(contact._id)}
                        className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100 shrink-0"
                        title="Apagar permanentemente"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {editingLeadId && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h4 className="text-lg font-bold text-white mb-4">Editar Lead CRM</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Estagio</label>
                <select
                  value={leadDraft.stage}
                  onChange={(e) => setLeadDraft((prev) => ({ ...prev, stage: e.target.value }))}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="new">Novo</option>
                  <option value="qualified">Qualificado</option>
                  <option value="proposal">Proposta</option>
                  <option value="won">Ganho</option>
                  <option value="lost">Perdido</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Score (0-100)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={leadDraft.score}
                  onChange={(e) => setLeadDraft((prev) => ({ ...prev, score: e.target.value }))}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Owner</label>
                <input
                  type="text"
                  value={leadDraft.owner}
                  onChange={(e) => setLeadDraft((prev) => ({ ...prev, owner: e.target.value }))}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Proxima acao</label>
                <input
                  type="datetime-local"
                  value={leadDraft.nextActionAt}
                  onChange={(e) => setLeadDraft((prev) => ({ ...prev, nextActionAt: e.target.value }))}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-slate-400">Tags (separadas por virgula)</label>
              <input
                type="text"
                value={leadDraft.tags}
                onChange={(e) => setLeadDraft((prev) => ({ ...prev, tags: e.target.value }))}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="mt-3">
              <label className="text-xs text-slate-400">Notas</label>
              <textarea
                rows={3}
                value={leadDraft.notes}
                onChange={(e) => setLeadDraft((prev) => ({ ...prev, notes: e.target.value }))}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingLeadId("")}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => saveLeadEditor(editingLeadId)}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
              >
                Salvar CRM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
