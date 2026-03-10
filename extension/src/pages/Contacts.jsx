import React, { useState, useEffect, useRef } from "react";
import { getContacts, addContact, deleteContact, importContactsXlsx } from "../utils/api";
import { Users, Upload, Plus, Trash2, Search, Activity, Phone, RefreshCw } from "lucide-react";

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [importing, setImporting] = useState(false);

  const fileInputRef = useRef(null);
  const agentId = localStorage.getItem("emidia_agent_id") || "agent-unknown";

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const data = await getContacts();
      setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
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
      const result = await importContactsXlsx(file);
      alert(`Importação concluída! ${result.imported} contatos adicionados e ${result.ignored_duplicates || 0} duplicados ignorados.`);
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

  const filteredContacts = contacts.filter((c) => {
    const query = search.toLowerCase();
    const matchesName = (c.name || "").toLowerCase().includes(query);
    const matchesPhone = (c.phone || "").toLowerCase().includes(query);
    return matchesName || matchesPhone;
  });

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200 overflow-y-auto w-full p-4 md:p-8 space-y-6">
      
      {/* HEADER COMPLETO RICH AESTHETICS */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-slate-800/60 p-6 md:px-8 rounded-3xl border border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-teal-500/10 rounded-full blur-3xl -ml-20 -mb-20 pointer-events-none"></div>

        <div className="flex items-start gap-4 z-10">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-500 p-3 rounded-2xl shadow-lg shadow-emerald-500/20">
            <Users className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-extrabold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Minha Agenda</h2>
            <div className="flex items-center gap-2 mt-1.5 opacity-80">
               <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
               <p className="text-sm font-mono tracking-wide text-slate-300">Agent: {agentId.split('-')[1]?.toUpperCase() || agentId}</p>
            </div>
            <p className="text-sm text-slate-400 mt-1 max-w-sm leading-relaxed">Gerencie os contatos isolados deste navegador. Nenhuma outra máquina tem acesso a esses dados.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto mt-4 md:mt-0 z-10">
           <input 
              type="file" 
              accept=".xlsx, .xls, .csv" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleImport} 
           />
           <button 
             onClick={() => fileInputRef.current?.click()}
             disabled={importing}
             className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-3 rounded-2xl font-semibold transition-all shadow-lg shadow-emerald-900/40 hover:shadow-emerald-900/60 disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0"
           >
             <Upload className={`w-5 h-5 ${importing ? "animate-bounce" : ""}`} />
             {importing ? "Lendo Planilha..." : "Importar Excel"}
           </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3.5 rounded-2xl flex items-center gap-3 backdrop-blur-sm animate-in fade-in slide-in-from-top-4">
          <Activity className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* COLUNA ESQUERDA: NOVO CONTATO MANUAL */}
        <div className="lg:col-span-1 border border-slate-700/50 bg-slate-800/40 p-6 rounded-3xl shadow-lg backdrop-blur-sm flex flex-col h-fit">
          <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
            <Plus className="w-5 h-5 text-emerald-400 bg-emerald-400/10 p-1.5 box-content rounded-lg" />
            Adicionar Manual
          </h3>
          <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-sm text-slate-400 pl-1">Nome (Opcional)</label>
              <input 
                type="text" 
                placeholder="Ex: João da Silva"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700/60 hover:border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
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
                  className="w-full bg-slate-900/50 border border-slate-700/60 hover:border-slate-600 rounded-xl pl-10 pr-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all font-mono tracking-wide"
                />
                <Phone className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button type="submit" className="mt-2 bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-medium transition-colors border border-slate-600">
              Salvar Contato
            </button>
          </form>
        </div>

        {/* COLUNA DIREITA: LISTA COM BUSCA */}
        <div className="lg:col-span-2 bg-slate-800/40 rounded-3xl border border-slate-700/50 shadow-lg flex flex-col overflow-hidden backdrop-blur-sm">
          <div className="p-5 md:p-6 border-b border-slate-700/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800/80">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-white">Listagem Completa</h3>
              <span className="bg-emerald-500/10 text-emerald-400 text-xs px-3 py-1 rounded-full border border-emerald-500/20 font-medium">
                {filteredContacts.length} salvos
              </span>
            </div>
            
            <div className="relative w-full md:w-64 group">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 group-focus-within:text-emerald-400 transition-colors" />
              <input
                 type="text"
                 placeholder="Buscar por nome ou número..."
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 className="w-full bg-slate-900 border border-slate-700/60 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
              />
            </div>
          </div>
          
          <div className="p-4 md:p-6 flex-1 overflow-y-auto max-h-[500px] scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-4 opacity-80" />
                <p>Sincronizando contatos com o banco seguro...</p>
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-500 text-center px-4">
                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700">
                  <Users className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-lg text-slate-300 font-medium mb-1">Nenhum contato encontrado</p>
                <p className="max-w-xs">{search ? "Altere os termos de busca para encontrar." : "Adicione manualmente ou importe uma planilha Excel para começar."}</p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredContacts.map((contact) => (
                  <li key={contact._id} className="bg-slate-900/60 border border-slate-700/50 hover:border-emerald-500/30 p-4 rounded-2xl flex items-center justify-between group transition-all duration-300 hover:shadow-lg hover:shadow-emerald-900/10 hover:-translate-y-0.5">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-slate-600/50 shrink-0 shadow-inner text-slate-300 font-medium uppercase">
                        {(contact.name ? contact.name[0] : '#')}
                      </div>
                      <div className="overflow-hidden">
                        <div className="text-slate-200 font-medium truncate" title={contact.name || "Sem Nome"}>
                          {contact.name || <span className="text-slate-500 italic">Sem Nome</span>}
                        </div>
                        <div className="text-sm text-emerald-400 tracking-wider font-mono mt-0.5 truncate">{contact.phone}</div>
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => handleDelete(contact._id)}
                      className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100 shrink-0"
                      title="Apagar permanentemente"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}