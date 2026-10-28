import React, { useState } from 'react';
import { Project, Task, QuotationItem, CostItem, CostCategory } from '../types';
import { getVatRates, getClients, registerClientIfNew, VatRateOption } from '../utils/variableSettings';
import { 
  X, 
  Building2, 
  Calendar, 
  Plus, 
  Trash2, 
  DollarSign, 
  TrendingUp, 
  FileText, 
  CheckCircle2, 
  AlertCircle,
  Tag,
  Receipt,
  UserCheck,
  Phone,
  Mail,
  MapPin,
  Clock,
  Layers,
  Folder,
  Copy,
  Check,
  CheckSquare,
  Square
} from 'lucide-react';

interface ProjectFinancialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  tasks: Task[];
  onSaveProject: (updated: Project) => void;
}

export const ProjectFinancialsModal: React.FC<ProjectFinancialsModalProps> = ({
  isOpen,
  onClose,
  project,
  tasks,
  onSaveProject,
}) => {
  const [activeTab, setActiveTab] = useState<'quotations' | 'costs' | 'client' | 'summary'>('quotations');

  // Client form fields
  const [clientName, setClientName] = useState(project.clientName || '');
  const [clientContactPerson, setClientContactPerson] = useState(project.clientContactPerson || '');
  const [clientPhone, setClientPhone] = useState(project.clientPhone || '');
  const [clientEmail, setClientEmail] = useState(project.clientEmail || '');
  const [clientNip, setClientNip] = useState(project.clientNip || '');
  const [clientAddress, setClientAddress] = useState(project.clientAddress || '');
  const [diskPath, setDiskPath] = useState(project.diskPath || '');
  const [copiedPath, setCopiedPath] = useState(false);
  
  // Dates
  const [startDate, setStartDate] = useState(project.startDate || '2026-10-01');
  const [dueDate, setDueDate] = useState(project.dueDate || '2027-02-28');

  // Quotation items
  const [quotations, setQuotations] = useState<QuotationItem[]>(() => {
    return (project.quotations || []).map((q) => ({
      ...q,
      companyName: q.companyName || project.clientName || 'Inwestor Główny',
      isSelected: q.isSelected !== undefined ? q.isSelected : true,
      taxType: q.taxType || 'netto',
    }));
  });

  // Quotation Form State
  const [newQuoteTitle, setNewQuoteTitle] = useState('');
  const [newQuoteCompany, setNewQuoteCompany] = useState(project.clientName || '');
  const [newQuoteQuantity, setNewQuoteQuantity] = useState(1);
  const [newQuoteUnit, setNewQuoteUnit] = useState('kpl');
  const [newQuotePrice, setNewQuotePrice] = useState(10000);
  const [newQuoteTaxType, setNewQuoteTaxType] = useState<'netto' | 'brutto' | 'zwolniony'>('netto');
  const [newQuoteVatRate, setNewQuoteVatRate] = useState(23);
  const [newQuoteIsSelected, setNewQuoteIsSelected] = useState(true);

  // Available VAT rates from system variables
  const vatRateOptions = getVatRates();
  const availableClients = getClients();

  // Costs items
  const [costs, setCosts] = useState<CostItem[]>(project.costs || []);
  const [newCostTitle, setNewCostTitle] = useState('');
  const [newCostCategory, setNewCostCategory] = useState<CostCategory>('mapa');
  const [newCostAmountNet, setNewCostAmountNet] = useState(5000);
  const [newCostVatRate, setNewCostVatRate] = useState(23);
  const [newCostContractor, setNewCostContractor] = useState('');
  const [newCostInvoice, setNewCostInvoice] = useState('');
  const [newCostTaskId, setNewCostTaskId] = useState<string>('');
  const [newCostDate, setNewCostDate] = useState(new Date().toISOString().slice(0, 10));
  const [newCostStatus, setNewCostStatus] = useState<'planned' | 'incurred' | 'paid'>('paid');

  if (!isOpen) return null;

  // Filter tasks belonging to this project
  const projectTasks = tasks.filter((t) => t.projectId === project.id);

  // Totals calculations - ONLY include selected quotations into project balance!
  const selectedQuotations = quotations.filter((q) => q.isSelected !== false);
  const totalQuotationNet = selectedQuotations.reduce((acc, q) => acc + (q.totalNet || 0), 0);
  const totalQuotationGross = selectedQuotations.reduce((acc, q) => acc + (q.totalGross || 0), 0);

  const totalCostsNet = costs.reduce((acc, c) => acc + (c.amountNet || 0), 0);
  const totalCostsGross = costs.reduce((acc, c) => acc + (c.amountGross || 0), 0);

  const profitNet = totalQuotationNet - totalCostsNet;
  const marginPercent = totalQuotationNet > 0 ? Math.round((profitNet / totalQuotationNet) * 100) : 0;

  // Costs by category
  const costsByCategory = costs.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + c.amountNet;
    return acc;
  }, {} as Record<CostCategory, number>);

  const handleAddQuotation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuoteTitle.trim()) return;

    let unitNet = Number(newQuotePrice);
    let unitGross = Number(newQuotePrice);
    let vatRate = newQuoteVatRate;

    if (newQuoteTaxType === 'zwolniony') {
      vatRate = 0;
      unitNet = Number(newQuotePrice);
      unitGross = unitNet;
    } else if (newQuoteTaxType === 'brutto') {
      unitGross = Number(newQuotePrice);
      unitNet = vatRate > 0 ? Math.round((unitGross / (1 + vatRate / 100)) * 100) / 100 : unitGross;
    } else {
      // 'netto'
      unitNet = Number(newQuotePrice);
      unitGross = Math.round(unitNet * (1 + vatRate / 100) * 100) / 100;
    }

    const totalNet = Math.round(Number(newQuoteQuantity) * unitNet * 100) / 100;
    const totalGross = Math.round(Number(newQuoteQuantity) * unitGross * 100) / 100;

    const newItem: QuotationItem = {
      id: `q-${Date.now()}`,
      title: newQuoteTitle.trim(),
      companyName: newQuoteCompany.trim() || clientName || 'Pracownia Projektowa',
      quantity: Number(newQuoteQuantity),
      unit: newQuoteUnit,
      unitPriceNet: unitNet,
      unitPriceGross: unitGross,
      taxType: newQuoteTaxType,
      vatRate,
      totalNet,
      totalGross,
      isSelected: newQuoteIsSelected,
      status: 'accepted',
    };

    setQuotations([...quotations, newItem]);
    setNewQuoteTitle('');
    setNewQuoteCompany(clientName || '');
    setNewQuoteQuantity(1);
    setNewQuotePrice(5000);
  };

  const handleToggleSelectQuotation = (id: string) => {
    setQuotations(
      quotations.map((q) => (q.id === id ? { ...q, isSelected: !q.isSelected } : q))
    );
  };

  const handleDeleteQuotation = (id: string) => {
    setQuotations(quotations.filter((q) => q.id !== id));
  };

  const handleAddCost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCostTitle.trim()) return;

    const net = Number(newCostAmountNet);
    const gross = Math.round(net * (1 + newCostVatRate / 100) * 100) / 100;

    const newCost: CostItem = {
      id: `cst-${Date.now()}`,
      projectId: project.id,
      taskId: newCostTaskId ? newCostTaskId : undefined,
      title: newCostTitle.trim(),
      category: newCostCategory,
      amountNet: net,
      amountGross: gross,
      contractorName: newCostContractor.trim() || undefined,
      invoiceNumber: newCostInvoice.trim() || undefined,
      date: newCostDate,
      status: newCostStatus,
    };

    setCosts([...costs, newCost]);
    setNewCostTitle('');
    setNewCostAmountNet(3000);
    setNewCostContractor('');
    setNewCostInvoice('');
  };

  const handleDeleteCost = (id: string) => {
    setCosts(costs.filter((c) => c.id !== id));
  };

  const handleSelectPredefinedClient = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = availableClients.find((c) => c.id === e.target.value);
    if (selected) {
      setClientName(selected.name);
      if (selected.contactPerson) setClientContactPerson(selected.contactPerson);
      if (selected.phone) setClientPhone(selected.phone);
      if (selected.email) setClientEmail(selected.email);
      if (selected.nip) setClientNip(selected.nip);
      if (selected.address) setClientAddress(selected.address);
    }
  };

  const handleCopyDiskPath = () => {
    if (!diskPath) return;
    navigator.clipboard.writeText(diskPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2500);
  };

  const handleSaveAll = () => {
    // If client was entered, register into variable database automatically
    if (clientName.trim()) {
      registerClientIfNew({
        name: clientName.trim(),
        contactPerson: clientContactPerson.trim() || undefined,
        phone: clientPhone.trim() || undefined,
        email: clientEmail.trim() || undefined,
        nip: clientNip.trim() || undefined,
        address: clientAddress.trim() || undefined,
      });
    }

    const updated: Project = {
      ...project,
      clientName: clientName.trim() || undefined,
      clientContactPerson: clientContactPerson.trim() || undefined,
      clientPhone: clientPhone.trim() || undefined,
      clientEmail: clientEmail.trim() || undefined,
      clientNip: clientNip.trim() || undefined,
      clientAddress: clientAddress.trim() || undefined,
      diskPath: diskPath.trim() || undefined,
      startDate,
      dueDate,
      quotations,
      costs,
      budget: `${totalQuotationNet.toLocaleString('pl-PL')} PLN`,
    };

    onSaveProject(updated);
    onClose();
  };

  const getCategoryLabel = (cat: CostCategory) => {
    switch (cat) {
      case 'mapa':
        return { label: '🗺️ Mapa do celów proj. (MDCP)', color: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' };
      case 'geologia':
        return { label: '🧪 Badania geotechniczne i grunt', color: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' };
      case 'uzgodnienia':
        return { label: '📋 Uzgodnienia ZUD/PPOŻ/Sanepid', color: 'text-sky-700 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800' };
      case 'podwykonawca':
        return { label: '🏗️ Podwykonawcy branżowi', color: 'text-purple-700 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800' };
      case 'oplaty_urzedowe':
        return { label: '🏛️ Opłaty urzędowe / skarbowe', color: 'text-slate-700 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700' };
      default:
        return { label: '📦 Inne koszty', color: 'text-slate-700 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700' };
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              {project.key.slice(0, 4)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                  {project.key}
                </span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {project.name}
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Opis projektu, Zamawiający, Terminy, Wyceny Inwestorskie oraz Kosztorys Branżowy
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Financial Stats Bar */}
        <div className="bg-slate-100/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Wycena w bilansie (Netto)</span>
            <span className="font-bold text-slate-900 dark:text-white text-sm font-mono">
              {totalQuotationNet.toLocaleString('pl-PL')} PLN
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Koszty łączne (Netto)</span>
            <span className="font-bold text-rose-600 dark:text-rose-400 text-sm font-mono">
              {totalCostsNet.toLocaleString('pl-PL')} PLN
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Wynik finansowy (Netto)</span>
            <span className={`font-bold text-sm font-mono ${profitNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {profitNet >= 0 ? '+' : ''}{profitNet.toLocaleString('pl-PL')} PLN
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Rentowność / Marża</span>
            <span className={`font-bold text-sm font-mono ${marginPercent >= 20 ? 'text-emerald-600 dark:text-emerald-400' : marginPercent > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {marginPercent}%
            </span>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/50 dark:bg-slate-900/50 gap-6 text-xs overflow-x-auto">
          <button
            onClick={() => setActiveTab('quotations')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'quotations'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>Wyceny i Oferty ({quotations.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('costs')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'costs'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Lista kosztów i zadania ({costs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('client')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'client'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Zamawiający, Dysk & Terminy</span>
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'summary'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Bilans & Rentowność</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* TAB 1: WYCENY Z LISTĄ */}
          {activeTab === 'quotations' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Wyceny i Oferta dla Zamawiającego
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    Zaznacz znacznik <strong>Wybrana</strong>, aby włączyć ofertę do bilansu projektu. Odrzucone lub alternatywne oferty możesz odznaczyć.
                  </p>
                </div>
                <div className="text-left sm:text-right bg-sky-50 dark:bg-sky-950/40 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800">
                  <span className="text-[11px] text-sky-800 dark:text-sky-300 block">
                    W bilansie ({selectedQuotations.length} z {quotations.length} ofert):
                  </span>
                  <span className="text-sm font-bold text-sky-600 dark:text-sky-400 font-mono">
                    {totalQuotationNet.toLocaleString('pl-PL')} zł netto ({totalQuotationGross.toLocaleString('pl-PL')} zł brutto)
                  </span>
                </div>
              </div>

              {/* Table of quotation items */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Do bilansu</th>
                      <th className="py-2.5 px-3 font-semibold">Nazwa wyceny</th>
                      <th className="py-2.5 px-3 font-semibold">Firma / Oferent</th>
                      <th className="py-2.5 px-3 font-semibold w-20">Ilość</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Typ & VAT</th>
                      <th className="py-2.5 px-3 font-semibold w-28 text-right">Wartość netto</th>
                      <th className="py-2.5 px-3 font-semibold w-28 text-right">Wartość brutto</th>
                      <th className="py-2.5 px-3 font-semibold w-12 text-center">Usuń</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {quotations.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-400">
                          Brak pozycji wyceny. Wypełnij poniższy formularz i dodaj pierwszą pozycję.
                        </td>
                      </tr>
                    ) : (
                      quotations.map((q) => {
                        const isSelected = q.isSelected !== false;
                        return (
                          <tr 
                            key={q.id} 
                            className={`transition-colors ${
                              isSelected 
                                ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60' 
                                : 'bg-slate-50/60 dark:bg-slate-950/40 opacity-70 hover:opacity-100'
                            }`}
                          >
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleSelectQuotation(q.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                                  isSelected
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
                                }`}
                                title={isSelected ? 'Kliknij, aby wykluczyć z bilansu' : 'Kliknij, aby włączyć do bilansu'}
                              >
                                {isSelected ? (
                                  <>
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Wybrana</span>
                                  </>
                                ) : (
                                  <>
                                    <Square className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Opcja</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {q.title}
                              {q.notes && <span className="block text-[10px] text-slate-400">{q.notes}</span>}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                              <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-medium text-[11px] text-slate-700 dark:text-slate-300">
                                {q.companyName || '—'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {q.quantity} {q.unit}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {q.taxType === 'zwolniony' ? 'ZW (0%)' : `${q.taxType || 'netto'} ${q.vatRate}%`}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                              {q.totalNet.toLocaleString('pl-PL')} zł
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                              {q.totalGross.toLocaleString('pl-PL')} zł
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() => handleDeleteQuotation(q.id)}
                                className="text-slate-400 hover:text-rose-600 p-1"
                                title="Usuń pozycję"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add quotation item form */}
              <form onSubmit={handleAddQuotation} className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                    + Dodaj nową wycenę / ofertę
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <input
                      type="checkbox"
                      checked={newQuoteIsSelected}
                      onChange={(e) => setNewQuoteIsSelected(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Włącz bezpośrednio do bilansu projektu (Wybrana)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Nazwa wyceny / zakresu *</label>
                    <input
                      type="text"
                      required
                      value={newQuoteTitle}
                      onChange={(e) => setNewQuoteTitle(e.target.value)}
                      placeholder="np. Koncepcja & Projekt Budowlany"
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Firma / Oferent</label>
                    <input
                      type="text"
                      value={newQuoteCompany}
                      onChange={(e) => setNewQuoteCompany(e.target.value)}
                      placeholder="np. Biuro Projektowe Architekci Sp. p."
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Ilość i jedn.</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min="1"
                        value={newQuoteQuantity}
                        onChange={(e) => setNewQuoteQuantity(Number(e.target.value))}
                        className="w-14 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white text-center"
                      />
                      <input
                        type="text"
                        value={newQuoteUnit}
                        onChange={(e) => setNewQuoteUnit(e.target.value)}
                        placeholder="kpl"
                        className="w-14 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white text-center"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Podstawa kwoty
                    </label>
                    <select
                      value={newQuoteTaxType}
                      onChange={(e) => setNewQuoteTaxType(e.target.value as any)}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="netto">Netto</option>
                      <option value="brutto">Brutto</option>
                      <option value="zwolniony">Zwolniony (ZW)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      {newQuoteTaxType === 'brutto' ? 'Cena brutto (zł) *' : 'Cena netto (zł) *'}
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={newQuotePrice}
                      onChange={(e) => setNewQuotePrice(Number(e.target.value))}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka VAT</label>
                    <select
                      disabled={newQuoteTaxType === 'zwolniony'}
                      value={newQuoteTaxType === 'zwolniony' ? 0 : newQuoteVatRate}
                      onChange={(e) => setNewQuoteVatRate(Number(e.target.value))}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-50"
                    >
                      {vatRateOptions.map((v) => (
                        <option key={v.id} value={v.value}>
                          {v.label} ({v.value}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-medium text-xs transition-colors shadow-xs"
                    >
                      + Dodaj wycenę do listy
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: LISTA KOSZTÓW I ZADANIA (MAPA, GEOLOGIA, UZGODNIENIA) */}
          {activeTab === 'costs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Koszty Projektowe i Podwykonawcy (Mapa, Geologia, Uzgodnienia)
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    Rejestr wydatków bezpośrednich powiązanych z etapami i zadaniami.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Suma kosztów:</span>
                  <span className="text-sm font-bold text-rose-600 dark:text-rose-400 font-mono">
                    {totalCostsNet.toLocaleString('pl-PL')} zł netto ({totalCostsGross.toLocaleString('pl-PL')} zł brutto)
                  </span>
                </div>
              </div>

              {/* Table of costs */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Tytuł kosztu</th>
                      <th className="py-2.5 px-3 font-semibold w-48">Kategoria branżowa</th>
                      <th className="py-2.5 px-3 font-semibold w-40">Powiązane zadanie</th>
                      <th className="py-2.5 px-3 font-semibold w-36">Wykonawca</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-right">Netto</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-right">Brutto</th>
                      <th className="py-2.5 px-3 font-semibold w-12 text-center">Usuń</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {costs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400">
                          Brak wprowadzonych kosztów branżowych. Dodaj koszt mapy, geologii lub uzgodnień poniżej.
                        </td>
                      </tr>
                    ) : (
                      costs.map((c) => {
                        const meta = getCategoryLabel(c.category);
                        const linkedTask = projectTasks.find((t) => t.id === c.taskId);
                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {c.title}
                              {c.invoiceNumber && (
                                <span className="block text-[10px] text-slate-400 font-mono">Faktura: {c.invoiceNumber}</span>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                              {linkedTask ? (
                                <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400 font-semibold">
                                  [{linkedTask.code}] {linkedTask.title.slice(0, 20)}...
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Ogólny projekt</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                              {c.contractorName || '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                              {c.amountNet.toLocaleString('pl-PL')} zł
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                              {c.amountGross.toLocaleString('pl-PL')} zł
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                onClick={() => handleDeleteCost(c.id)}
                                className="text-slate-400 hover:text-rose-600 p-1"
                                title="Usuń koszt"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add cost form */}
              <form onSubmit={handleAddCost} className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  + Zarejestruj nowy koszt (Mapa, Geologia, Uzgodnienia, Podwykonawcy)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Tytuł kosztu / opis opracowania *</label>
                    <input
                      type="text"
                      required
                      value={newCostTitle}
                      onChange={(e) => setNewCostTitle(e.target.value)}
                      placeholder="np. Opracowanie Mapy do Celów Projektowych (MDCP)"
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kategoria kosztu</label>
                    <select
                      value={newCostCategory}
                      onChange={(e) => setNewCostCategory(e.target.value as CostCategory)}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="mapa">🗺️ Mapa (MDCP)</option>
                      <option value="geologia">🧪 Badania geologiczne i grunt</option>
                      <option value="uzgodnienia">📋 Uzgodnienia ZUD/PPOŻ/Sanepid</option>
                      <option value="podwykonawca">🏗️ Branżysta / Konstruktor</option>
                      <option value="oplaty_urzedowe">🏛️ Opłaty skarbowe / urzędowe</option>
                      <option value="inne">📦 Inne wydatki</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Przypisz do zadania</label>
                    <select
                      value={newCostTaskId}
                      onChange={(e) => setNewCostTaskId(e.target.value)}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="">-- Koszt ogólny projektu --</option>
                      {projectTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code}: {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kwota netto (zł) *</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={newCostAmountNet}
                      onChange={(e) => setNewCostAmountNet(Number(e.target.value))}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka VAT</label>
                    <select
                      value={newCostVatRate}
                      onChange={(e) => setNewCostVatRate(Number(e.target.value))}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      {vatRateOptions.map((v) => (
                        <option key={v.id} value={v.value}>
                          {v.label} ({v.value}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Wykonawca / Rzeczoznawca</label>
                    <input
                      type="text"
                      value={newCostContractor}
                      onChange={(e) => setNewCostContractor(e.target.value)}
                      placeholder="np. Biuro Geodezyjne GEO-PRO"
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-medium text-xs transition-colors shadow-xs"
                    >
                      + Zapisz koszt
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: ZAMAWIAJĄCY & DYSK & TERMINY */}
          {activeTab === 'client' && (
            <div className="space-y-4">
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                Dane Zamawiającego (Inwestora), Lokalizacja na Dysku & Ramy Czasowe Projektu
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Investor details */}
                <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-sky-600" />
                      <span>Inwestor / Zamawiający</span>
                    </h5>
                    {availableClients.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500">Wybierz:</span>
                        <select
                          onChange={handleSelectPredefinedClient}
                          defaultValue=""
                          className="text-[11px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2 py-0.5 text-slate-700 dark:text-slate-300"
                        >
                          <option value="" disabled>-- Baza inwestorów --</option>
                          {availableClients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Nazwa Inwestora / Zamawiającego</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="np. Nordic Development Sp. z o.o."
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Osoba kontaktowa (reprezentant)</label>
                    <input
                      type="text"
                      value={clientContactPerson}
                      onChange={(e) => setClientContactPerson(e.target.value)}
                      placeholder="np. Marek Zawadzki - Dyrektor Techniczny"
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Telefon</label>
                      <input
                        type="text"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        placeholder="+48 22 555 12 34"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">E-mail</label>
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="kontakt@inwestor.pl"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">NIP</label>
                      <input
                        type="text"
                        value={clientNip}
                        onChange={(e) => setClientNip(e.target.value)}
                        placeholder="525-000-00-00"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Adres Inwestora</label>
                      <input
                        type="text"
                        value={clientAddress}
                        onChange={(e) => setClientAddress(e.target.value)}
                        placeholder="ul. Inwestycyjna 1, Warszawa"
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Disk Path and Dates */}
                <div className="space-y-4">
                  {/* Disk location card */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                      <Folder className="w-4 h-4 text-amber-500" />
                      <span>Lokalizacja na dysku / serwerze NAS</span>
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ścieżka do katalogu projektu w sieci lokalnej lub na dysku roboczym pracowni.
                    </p>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={diskPath}
                        onChange={(e) => setDiskPath(e.target.value)}
                        placeholder="np. Z:\PROJEKTY\2026\2026-01-NordicTower lub /mnt/projekty/2026/01"
                        className="flex-1 font-mono text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={handleCopyDiskPath}
                        disabled={!diskPath}
                        className={`px-3 py-2 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
                          copiedPath
                            ? 'bg-emerald-500 text-white border-emerald-600'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                        } disabled:opacity-40`}
                        title="Kopiuj ścieżkę do schowka"
                      >
                        {copiedPath ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedPath ? 'Skopiowano' : 'Kopiuj'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Project Dates */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-emerald-600" />
                      <span>Termin rozpoczęcia i zakończenia</span>
                    </h5>

                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Data rozpoczęcia</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Termin końcowy (zakończenie wyceny / umowy)</label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BILANS & RENTOWNOŚĆ */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                Analiza Finansowa i Rentowność Projektu
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                  <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 block mb-1">
                    Wycena / Przychód pracowni (Wybrane)
                  </span>
                  <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                    {totalQuotationNet.toLocaleString('pl-PL')} PLN
                  </div>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block mt-1">
                    Brutto z VAT: {totalQuotationGross.toLocaleString('pl-PL')} PLN
                  </span>
                </div>

                <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg">
                  <span className="text-xs font-semibold text-rose-800 dark:text-rose-300 block mb-1">
                    Koszty poniesione (Netto)
                  </span>
                  <div className="text-xl font-bold font-mono text-rose-700 dark:text-rose-400">
                    {totalCostsNet.toLocaleString('pl-PL')} PLN
                  </div>
                  <span className="text-[11px] text-rose-600 dark:text-rose-400 block mt-1">
                    Brutto z VAT: {totalCostsGross.toLocaleString('pl-PL')} PLN
                  </span>
                </div>

                <div className={`p-4 rounded-lg border ${profitNet >= 0 ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800' : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800'}`}>
                  <span className="text-xs font-semibold text-sky-800 dark:text-sky-300 block mb-1">
                    Zysk operacyjny (Netto)
                  </span>
                  <div className={`text-xl font-bold font-mono ${profitNet >= 0 ? 'text-sky-700 dark:text-sky-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {profitNet >= 0 ? '+' : ''}{profitNet.toLocaleString('pl-PL')} PLN
                  </div>
                  <span className="text-[11px] text-sky-600 dark:text-sky-400 block mt-1 font-semibold">
                    Marża projektu: {marginPercent}%
                  </span>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                  Struktura poniesionych kosztów zewnętrznych:
                </h5>
                <div className="space-y-2">
                  {(Object.keys(costsByCategory) as CostCategory[]).map((catKey) => {
                    const catAmount = costsByCategory[catKey] || 0;
                    const catPct = totalCostsNet > 0 ? Math.round((catAmount / totalCostsNet) * 100) : 0;
                    const meta = getCategoryLabel(catKey);
                    return (
                      <div key={catKey} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {catAmount.toLocaleString('pl-PL')} PLN
                          </span>
                          <span className="text-slate-400 text-[11px] w-12 text-right">
                            {catPct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
          >
            Anuluj
          </button>

          <button
            type="button"
            onClick={handleSaveAll}
            className="flex items-center gap-1.5 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded font-semibold text-xs shadow-xs transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Zapisz zmiany w projekcie i kosztorysie</span>
          </button>
        </div>
      </div>
    </div>
  );
};
