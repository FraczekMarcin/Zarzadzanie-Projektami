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
  
  // Base Contract Value (Wartość projektu z umowy)
  const [baseContractValue, setBaseContractValue] = useState<number>(project.projectValue || 0);
  const [projectVatRate, setProjectVatRate] = useState<number>(project.projectVatRate !== undefined ? project.projectVatRate : 23);
  const [isBaseContractPaid, setIsBaseContractPaid] = useState<boolean>(project.status === 'completed');

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
      isPaid: q.isPaid || false,
    }));
  });

  // Quotation Form State
  const [newQuoteTitle, setNewQuoteTitle] = useState('');
  const [newQuoteCompany, setNewQuoteCompany] = useState(project.clientName || '');
  const [newQuoteDirection, setNewQuoteDirection] = useState<'przychod' | 'koszt'>('przychod');
  const [newQuoteQuantity, setNewQuoteQuantity] = useState(1);
  const [newQuoteUnit, setNewQuoteUnit] = useState('kpl');
  const [newQuotePrice, setNewQuotePrice] = useState(10000);
  const [newQuoteTaxType, setNewQuoteTaxType] = useState<'netto' | 'brutto' | 'zwolniony'>('netto');
  const [newQuoteVatRate, setNewQuoteVatRate] = useState(23);
  const [newQuoteIsSelected, setNewQuoteIsSelected] = useState(true);
  const [newQuoteIsPaid, setNewQuoteIsPaid] = useState(false);

  // Available VAT rates from system variables
  const vatRateOptions = getVatRates();
  const availableClients = getClients();

  // Costs items
  const [costs, setCosts] = useState<CostItem[]>(() => {
    return (project.costs || []).map((c) => ({
      ...c,
      isPaid: c.isPaid !== undefined ? c.isPaid : c.status === 'paid',
    }));
  });
  const [newCostTitle, setNewCostTitle] = useState('');
  const [newCostCategory, setNewCostCategory] = useState<CostCategory>('mapa');
  const [newCostAmountNet, setNewCostAmountNet] = useState(5000);
  const [newCostVatRate, setNewCostVatRate] = useState(23);
  const [newCostContractor, setNewCostContractor] = useState('');
  const [newCostInvoice, setNewCostInvoice] = useState('');
  const [newCostTaskId, setNewCostTaskId] = useState<string>('');
  const [newCostDate, setNewCostDate] = useState(new Date().toISOString().slice(0, 10));
  const [newCostStatus, setNewCostStatus] = useState<'planned' | 'incurred' | 'paid'>('paid');
  const [newCostIsPaid, setNewCostIsPaid] = useState(true);

  if (!isOpen) return null;

  // Filter tasks belonging to this project
  const projectTasks = tasks.filter((t) => t.projectId === project.id);

  // Totals calculations:
  // - Only SELECTED items (isSelected !== false) enter the project balance!
  // - Base contract value (project.projectValue) is the foundation of project revenue!
  // - Items with type === 'koszt' count into costs
  // - Items with type === 'przychod' count into revenue (wartość projektu)
  // - Unselected items (isSelected === false) stay outside balance as optional variants/quotes
  const selectedQuotations = quotations.filter((q) => q.isSelected !== false);
  const revenueQuotes = selectedQuotations.filter((q) => q.type !== 'koszt');
  const costQuotes = selectedQuotations.filter((q) => q.type === 'koszt');

  const baseProjectValueNet = Number(baseContractValue || 0);
  const baseProjectValueGross = Math.round(baseProjectValueNet * (1 + (projectVatRate || 23) / 100) * 100) / 100;

  const totalQuotationNet = revenueQuotes.reduce((acc, q) => acc + (q.totalNet || 0), 0);
  const totalQuotationGross = revenueQuotes.reduce((acc, q) => acc + (q.totalGross || 0), 0);

  // Total project revenue = Base contract value + accepted revenue quotes
  const totalRevenueNet = baseProjectValueNet + totalQuotationNet;
  const totalRevenueGross = baseProjectValueGross + totalQuotationGross;

  const directCostsNet = costs.reduce((acc, c) => acc + (c.amountNet || 0), 0);
  const directCostsGross = costs.reduce((acc, c) => acc + (c.amountGross || 0), 0);

  const quoteCostsNet = costQuotes.reduce((acc, q) => acc + (q.totalNet || 0), 0);
  const quoteCostsGross = costQuotes.reduce((acc, q) => acc + (q.totalGross || 0), 0);

  const totalCostsNet = directCostsNet + quoteCostsNet;
  const totalCostsGross = directCostsGross + quoteCostsGross;

  const profitNet = totalRevenueNet - totalCostsNet;
  const marginPercent = totalRevenueNet > 0 ? Math.round((profitNet / totalRevenueNet) * 100) : 0;

  // Paid vs Unpaid breakdown
  const paidRevenueNet = (isBaseContractPaid ? baseProjectValueNet : 0) + 
    revenueQuotes.filter((q) => q.isPaid).reduce((acc, q) => acc + (q.totalNet || 0), 0);
  const unpaidRevenueNet = Math.max(0, totalRevenueNet - paidRevenueNet);

  const paidCostsNet = costs.filter((c) => c.isPaid || c.status === 'paid').reduce((acc, c) => acc + (c.amountNet || 0), 0) +
    costQuotes.filter((q) => q.isPaid).reduce((acc, q) => acc + (q.totalNet || 0), 0);
  const unpaidCostsNet = Math.max(0, totalCostsNet - paidCostsNet);

  // Toggle paid handlers
  const handleToggleQuotationPaid = (id: string) => {
    setQuotations((prev) =>
      prev.map((q) => (q.id === id ? { ...q, isPaid: !q.isPaid, paidAt: !q.isPaid ? new Date().toISOString() : undefined } : q))
    );
  };

  const handleToggleCostPaid = (id: string) => {
    setCosts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isPaid: !c.isPaid, status: !c.isPaid ? 'paid' : 'incurred' } : c))
    );
  };

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
      type: newQuoteDirection,
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
      projectValue: baseProjectValueNet,
      projectValueGross: baseProjectValueGross,
      projectVatRate,
      quotations,
      costs,
      budget: baseProjectValueNet > 0 
        ? `${baseProjectValueNet.toLocaleString('pl-PL')} PLN` 
        : `${totalRevenueNet.toLocaleString('pl-PL')} PLN`,
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
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Wartość Projektu (Netto)</span>
            <span className="font-bold text-slate-900 dark:text-white text-sm font-mono">
              {totalRevenueNet.toLocaleString('pl-PL')} PLN
            </span>
            {baseProjectValueNet > 0 && (
              <span className="text-[10px] text-slate-400 block">Umowa: {baseProjectValueNet.toLocaleString('pl-PL')} zł</span>
            )}
          </div>

          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Koszty łączne (Netto)</span>
            <span className="font-bold text-rose-600 dark:text-rose-400 text-sm font-mono">
              {totalCostsNet.toLocaleString('pl-PL')} PLN
            </span>
            <span className="text-[10px] text-slate-400 block">Opłacono: {paidCostsNet.toLocaleString('pl-PL')} zł</span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Wynik finansowy (Netto)</span>
            <span className={`font-bold text-sm font-mono ${profitNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {profitNet >= 0 ? '+' : ''}{profitNet.toLocaleString('pl-PL')} PLN
            </span>
            <span className="text-[10px] text-slate-400 block">Marża: {marginPercent}%</span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Status płatności (Wpłaty)</span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                Zapłacono: {paidRevenueNet.toLocaleString('pl-PL')} zł
              </span>
            </div>
            {unpaidRevenueNet > 0 && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold block">
                Do zapłaty: {unpaidRevenueNet.toLocaleString('pl-PL')} zł
              </span>
            )}
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

              {/* Base Project Contract Value (Kwota umowy) */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block">
                      Wartość bazowa projektu (kwota umowy głównej)
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Podstawa przychodu w bilansie projektu. Dodatkowe pozycje poniżej to wyceny uzupełniające.
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div>
                    <span className="block text-[10px] text-slate-500">Kwota netto PLN</span>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={baseContractValue}
                      onChange={(e) => setBaseContractValue(Number(e.target.value))}
                      className="w-32 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500">Stawka VAT</span>
                    <select
                      value={projectVatRate}
                      onChange={(e) => setProjectVatRate(Number(e.target.value))}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white"
                    >
                      {vatRateOptions.map((v) => (
                        <option key={v.id} value={v.value ?? v.rate}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pt-3">
                    <button
                      type="button"
                      onClick={() => setIsBaseContractPaid(!isBaseContractPaid)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold border flex items-center gap-1 transition-colors ${
                        isBaseContractPaid
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {isBaseContractPaid ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-slate-400" />}
                      <span>{isBaseContractPaid ? 'Umowa opłacona' : 'Umowa nieopłacona'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Table of quotation items */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold w-28 text-center">Do bilansu</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Zapłacono</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Rodzaj</th>
                      <th className="py-2.5 px-3 font-semibold">Nazwa wyceny / zakres</th>
                      <th className="py-2.5 px-3 font-semibold">Firma / Oferent</th>
                      <th className="py-2.5 px-3 font-semibold w-16">Ilość</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Typ & VAT</th>
                      <th className="py-2.5 px-3 font-semibold w-28 text-right">Wartość netto</th>
                      <th className="py-2.5 px-3 font-semibold w-28 text-right">Wartość brutto</th>
                      <th className="py-2.5 px-3 font-semibold w-12 text-center">Usuń</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {quotations.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-6 text-center text-slate-400">
                          Brak pozycji wyceny. Wypełnij poniższy formularz i dodaj pierwszą pozycję.
                        </td>
                      </tr>
                    ) : (
                      quotations.map((q) => {
                        const isSelected = q.isSelected !== false;
                        const isCost = q.type === 'koszt';
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
                                    ? isCost
                                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
                                }`}
                                title={isSelected ? 'Kliknij, aby odznaczyć i wykluczyć z bilansu' : 'Kliknij, aby zaznaczyć i włączyć do bilansu'}
                              >
                                {isSelected ? (
                                  <>
                                    <CheckSquare className={`w-3.5 h-3.5 ${isCost ? 'text-rose-600' : 'text-emerald-600'}`} />
                                    <span>Wybrana</span>
                                  </>
                                ) : (
                                  <>
                                    <Square className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Opcja (poza)</span>
                                  </>
                                )}
                              </button>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleQuotationPaid(q.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                                  q.isPaid
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700 hover:border-slate-400'
                                }`}
                                title={q.isPaid ? 'Oznacz jako nieopłacone' : 'Oznacz jako zapłacone'}
                              >
                                {q.isPaid ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Clock className="w-3 h-3 text-slate-400" />}
                                <span>{q.isPaid ? 'Zapłacono' : 'Czeka'}</span>
                              </button>
                            </td>
                            <td className="py-2 px-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                isCost 
                                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                                  : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                              }`}>
                                {isCost ? '📉 Koszt (-)' : '📈 Przychód (+)'}
                              </span>
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
                            <td className={`py-2 px-3 text-right font-mono font-bold ${isCost ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                              {isCost ? '-' : '+'}{q.totalNet.toLocaleString('pl-PL')} zł
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                    + Dodaj nową pozycję oferty / wyceny
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <input
                      type="checkbox"
                      checked={newQuoteIsSelected}
                      onChange={(e) => setNewQuoteIsSelected(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Wybrana (uwzględnij w bilansie projektu)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Kierunek pozycji (Przychód / Koszt) *
                    </label>
                    <select
                      value={newQuoteDirection}
                      onChange={(e) => setNewQuoteDirection(e.target.value as 'przychod' | 'koszt')}
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-semibold"
                    >
                      <option value="przychod">📈 Przychód: Wycena dla Inwestora</option>
                      <option value="koszt">📉 Koszt: Oferta podwykonawcy / branżysty</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Nazwa wyceny / zakresu *</label>
                    <input
                      type="text"
                      required
                      value={newQuoteTitle}
                      onChange={(e) => setNewQuoteTitle(e.target.value)}
                      placeholder="np. Koncepcja & Projekt Budowlany PAB"
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
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
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="netto">Netto</option>
                      <option value="brutto">Brutto</option>
                      <option value="zwolniony">Zwolniony (ZW)</option>
                    </select>
                  </div>

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
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded font-medium text-xs transition-colors shadow-xs flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Dodaj wycenę do listy</span>
                  </button>
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
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Zapłacono</th>
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
                        <td colSpan={8} className="py-6 text-center text-slate-400">
                          Brak wprowadzonych kosztów branżowych. Dodaj koszt mapy, geologii lub uzgodnień poniżej.
                        </td>
                      </tr>
                    ) : (
                      costs.map((c) => {
                        const meta = getCategoryLabel(c.category);
                        const linkedTask = projectTasks.find((t) => t.id === c.taskId);
                        const isCostPaid = c.isPaid !== undefined ? c.isPaid : c.status === 'paid';
                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {c.title}
                              {c.invoiceNumber && (
                                <span className="block text-[10px] text-slate-400 font-mono">Faktura: {c.invoiceNumber}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleCostPaid(c.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                                  isCostPaid
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700 hover:border-slate-400'
                                }`}
                                title={isCostPaid ? 'Oznacz jako nieopłacone' : 'Oznacz jako opłacone'}
                              >
                                {isCostPaid ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Clock className="w-3 h-3 text-slate-400" />}
                                <span>{isCostPaid ? 'Zapłacono' : 'Czeka'}</span>
                              </button>
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

              {/* Project Value Breakdown into elements */}
              <div className="p-4 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <h5 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-sky-600" />
                    <span>Wartość Projektu — Rozbicie na poszczególne elementy i etapy</span>
                  </h5>
                  <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    Suma: {totalQuotationNet.toLocaleString('pl-PL')} PLN netto
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    1. Składowe przychodu pracowni (Wybrane etapy dla Zamawiającego):
                  </div>
                  {revenueQuotes.length === 0 ? (
                    <div className="text-[11px] text-slate-400 italic">Brak wybranych pozycji przychodowych</div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-200 dark:border-slate-700">
                      {revenueQuotes.map((q) => (
                        <div key={q.id} className="p-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{q.title}</span>
                            <span className="text-[10px] text-slate-500">({q.companyName})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                              {q.totalNet.toLocaleString('pl-PL')} zł netto
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({q.totalGross.toLocaleString('pl-PL')} brutto)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pt-2">
                    2. Koszty zewnętrzne i podwykonawcy branżowi (MDCP, Geologia, Uzgodnienia):
                  </div>
                  {totalCostsNet === 0 ? (
                    <div className="text-[11px] text-slate-400 italic">Brak przypisanych kosztów</div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-slate-50/50 dark:bg-slate-900/40 rounded border border-slate-200 dark:border-slate-700">
                      {costQuotes.map((q) => (
                        <div key={q.id} className="p-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{q.title}</span>
                            <span className="text-[10px] text-slate-500">({q.companyName})</span>
                          </div>
                          <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                            -{q.totalNet.toLocaleString('pl-PL')} zł netto
                          </span>
                        </div>
                      ))}
                      {costs.map((c) => (
                        <div key={c.id} className="p-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{c.title}</span>
                            {c.contractorName && <span className="text-[10px] text-slate-500">({c.contractorName})</span>}
                          </div>
                          <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                            -{c.amountNet.toLocaleString('pl-PL')} zł netto
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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
