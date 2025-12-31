import React, { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, PieChart, X, Plus, RefreshCw } from 'lucide-react';
import { GOOGLE_CONFIG } from './config';

class SheetsAPI {
  static tokenClient = null;
  static gapiInited = false;
  static gisInited = false;

  static async initGoogleAPI() {
    return new Promise((resolve) => {
      if (!window.gapi) {
        console.error('Google API not loaded');
        resolve();
        return;
      }
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({
            apiKey: GOOGLE_CONFIG.API_KEY,
            discoveryDocs: [GOOGLE_CONFIG.DISCOVERY_DOC],
          });
          this.gapiInited = true;
        } catch (err) {
          console.error('Error initializing Google API:', err);
        }
        resolve();
      });
    });
  }

  static initGoogleIdentity(callback) {
    if (!window.google?.accounts?.oauth2) {
      console.error('Google Identity Services not loaded');
      return;
    }
    try {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CONFIG.CLIENT_ID,
        scope: GOOGLE_CONFIG.SCOPES,
        callback: callback,
      });
      this.gisInited = true;
    } catch (err) {
      console.error('Error initializing Google Identity:', err);
    }
  }

  static async authorize() {
  return new Promise((resolve, reject) => {
    if (!this.tokenClient) {
      reject(new Error('Token client not initialized'));
      return;
    }
    
    this.tokenClient.callback = (resp) => {
      if (resp.error !== undefined) {
        reject(resp);
      } else {
        resolve();
      }
    };
    
    // This is the part to update/replace
    if (window.gapi.client.getToken() === null) {
      this.tokenClient.requestAccessToken({ prompt: 'consent', ux_mode: 'redirect' });
    } else {
      this.tokenClient.requestAccessToken({ prompt: '', ux_mode: 'redirect' });
    }
  });
}

  static async readSheet(range) {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_CONFIG.SPREADSHEET_ID,
      range: range,
    });
    return response.result.values || [];
  }

  static async writeSheet(range, values) {
    const response = await window.gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_CONFIG.SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: values },
    });
    return response.result;
  }

  static parseDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dateStr;
  }

  static formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('assets');
  const [assets, setAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState(null);
  const [setupNeeded, setSetupNeeded] = useState(false);

  useEffect(() => {
    console.log('App mounting...');
    
    // Check if credentials are configured
    if (GOOGLE_CONFIG.CLIENT_ID.includes('YOUR_CLIENT_ID') || 
        GOOGLE_CONFIG.API_KEY.includes('YOUR_API_KEY')) {
      console.log('Google credentials not configured');
      setSetupNeeded(true);
      setIsLoading(false);
      return;
    }

    const loadAPIs = async () => {
      try {
        console.log('Waiting for Google APIs to load...');
        await new Promise((resolve) => {
          let attempts = 0;
          const checkGapi = setInterval(() => {
            attempts++;
            if (window.gapi && window.google) {
              console.log('Google APIs loaded');
              clearInterval(checkGapi);
              resolve();
            } else if (attempts > 50) {
              console.error('Timeout waiting for Google APIs');
              clearInterval(checkGapi);
              resolve();
            }
          }, 100);
        });

        await SheetsAPI.initGoogleAPI();
        SheetsAPI.initGoogleIdentity(handleAuthCallback);
        setIsLoading(false);
      } catch (err) {
        console.error('Error initializing APIs:', err);
        setError('Failed to initialize: ' + err.message);
        setIsLoading(false);
      }
    };

    loadAPIs();
  }, []);

  const handleAuthCallback = async () => {
    console.log('Auth callback triggered');
    setIsAuthenticated(true);
    await loadData();
  };

  const handleSignIn = async () => {
    try {
      console.log('Sign in clicked');
      setError(null);
      await SheetsAPI.authorize();
    } catch (err) {
      console.error('Sign in error:', err);
      setError('Failed to sign in: ' + err.message);
    }
  };

  const loadData = async () => {
    try {
      console.log('Loading data...');
      setIsLoading(true);
      const accountsData = await SheetsAPI.readSheet('accounts!A2:B');
      const loadedAccounts = accountsData.map((row, idx) => ({
        id: idx + 1,
        accountName: row[0] || '',
        owner: row[1] || ''
      }));
      setAccounts(loadedAccounts);
      const transactionsData = await SheetsAPI.readSheet('transactions!A2:H');
      const loadedTransactions = transactionsData.map((row, idx) => {
        const account = loadedAccounts.find(a => a.accountName === row[7]);
        return {
          id: idx + 1,
          date: SheetsAPI.parseDate(row[0] || ''),
          type: row[1] || '',
          asset: row[2] || '',
          symbol: row[3] || '',
          transactedUnits: parseFloat(row[4]) || 0,
          transactedPrice: parseFloat(row[5]) || 0,
          fees: parseFloat(row[6]) || 0,
          accountName: row[7] || '',
          owner: account?.owner || ''
        };
      });
      setTransactions(loadedTransactions);
      calculateAssets(loadedTransactions);
      console.log('Data loaded successfully');
      setIsLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load data: ' + err.message);
      setIsLoading(false);
    }
  };

  const calculateAssets = (txns) => {
    const assetMap = {};
    txns.forEach(txn => {
      if (!assetMap[txn.symbol]) {
        assetMap[txn.symbol] = {
          asset: txn.asset,
          symbol: txn.symbol,
          portfolio: 'General',
          category: 'Stock',
          exchange: 'N/A',
          currency: 'USD',
          currentPrice: 100,
          transactions: []
        };
      }
      assetMap[txn.symbol].transactions.push(txn);
    });
    const calculatedAssets = Object.values(assetMap).map(assetData => {
      let currentHoldings = 0;
      let cumulativeHoldings = 0;
      let costOfCurrentHoldings = 0;
      let cumulativeCost = 0;
      let realizedPL = 0;
      let dividends = 0;
      assetData.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
      assetData.transactions.forEach(txn => {
        if (txn.type === 'Buy') {
          currentHoldings += txn.transactedUnits;
          cumulativeHoldings += txn.transactedUnits;
          const cost = txn.transactedUnits * txn.transactedPrice + txn.fees;
          costOfCurrentHoldings += cost;
          cumulativeCost += cost;
        } else if (txn.type === 'Sell') {
          cumulativeHoldings += txn.transactedUnits;
          currentHoldings -= txn.transactedUnits;
          const saleValue = txn.transactedUnits * txn.transactedPrice - txn.fees;
          const avgCost = costOfCurrentHoldings / (currentHoldings + txn.transactedUnits);
          const costBasis = avgCost * txn.transactedUnits;
          costOfCurrentHoldings -= costBasis;
          cumulativeCost += txn.fees;
          realizedPL += saleValue - costBasis;
        } else if (txn.type === 'Dividend') {
          dividends += txn.transactedUnits * txn.transactedPrice - txn.fees;
        }
      });
      const costPerUnit = currentHoldings > 0 ? costOfCurrentHoldings / currentHoldings : 0;
      const currentValue = currentHoldings * assetData.currentPrice;
      const paperProfitLoss = currentValue - costOfCurrentHoldings;
      const paperProfitLossPercent = costOfCurrentHoldings > 0 ? (paperProfitLoss / costOfCurrentHoldings) * 100 : 0;
      const sgdRate = assetData.currency === 'SGD' ? 1 : 1.35;
      return {
        asset: assetData.asset,
        symbol: assetData.symbol,
        portfolio: assetData.portfolio,
        category: assetData.category,
        exchange: assetData.exchange,
        currentPrice: assetData.currentPrice,
        currentHoldings,
        cumulativeHoldings,
        currency: assetData.currency,
        costOfCurrentHoldings,
        cumulativeCost,
        costPerUnit,
        costOfCurrentHoldingsSGD: costOfCurrentHoldings * sgdRate,
        currentValue,
        currentValueSGD: currentValue * sgdRate,
        paperProfitLoss,
        paperProfitLossPercent,
        realizedProfitLossSGD: realizedPL * sgdRate,
        dividendsCollected: dividends,
        dividendsCollectedSGD: dividends * sgdRate,
        lastDPU: 0,
        yieldOnCost: costOfCurrentHoldings > 0 ? (dividends / costOfCurrentHoldings) * 100 : 0,
        lastPriceYield: 0,
        totalProfitLossSGD: (paperProfitLoss + realizedPL + dividends) * sgdRate,
        roiPercent: cumulativeCost > 0 ? ((paperProfitLoss + realizedPL + dividends) / cumulativeCost) * 100 : 0
      };
    });
    setAssets(calculatedAssets);
  };

  const handleAddTransaction = async (transaction) => {
    const row = [
      SheetsAPI.formatDate(transaction.date),
      transaction.type,
      transaction.asset,
      transaction.symbol,
      transaction.transactedUnits,
      transaction.transactedPrice,
      transaction.fees,
      transaction.accountName
    ];
    await SheetsAPI.writeSheet('transactions!A:H', [row]);
    await loadData();
  };

  if (setupNeeded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">⚙️ Setup Required</h1>
          <p className="text-slate-600 mb-4">Your app is deployed successfully, but you need to configure Google Sheets credentials.</p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-blue-900 mb-2">Next Steps:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
              <li>Set up Google Cloud Project and enable Google Sheets API</li>
              <li>Create OAuth 2.0 credentials</li>
              <li>Update <code className="bg-blue-100 px-1 rounded">src/config.js</code> with your credentials</li>
              <li>Push changes to GitHub (Vercel will auto-deploy)</li>
            </ol>
          </div>

          <div className="bg-slate-50 rounded p-4 mb-4">
            <p className="text-sm text-slate-700 mb-2"><strong>Current config.js location:</strong></p>
            <code className="text-xs bg-slate-100 p-2 rounded block">src/config.js</code>
          </div>

          <p className="text-sm text-slate-600">
            Refer to the <strong>Deployment Guide</strong> for detailed instructions on setting up Google Cloud credentials.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">Asset Portfolio Tracker</h1>
          <p className="text-slate-600 mb-6">Sign in with your Google account to access your portfolio data.</p>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>}
          <button onClick={handleSignIn} className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-semibold w-full">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Asset Portfolio Tracker</h1>
            <p className="text-slate-600">Connected to Google Sheets</p>
          </div>
          <button onClick={loadData} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
            <RefreshCw size={18} />
            Refresh Data
          </button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6 text-sm">{error}</div>}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="flex border-b">
            <button onClick={() => setActiveTab('assets')} className={`px-6 py-3 font-semibold ${activeTab === 'assets' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'}`}>
              Assets ({assets.length})
            </button>
            <button onClick={() => setActiveTab('transactions')} className={`px-6 py-3 font-semibold ${activeTab === 'transactions' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'}`}>
              Transactions ({transactions.length})
            </button>
            <button onClick={() => setActiveTab('accounts')} className={`px-6 py-3 font-semibold ${activeTab === 'accounts' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'}`}>
              Accounts ({accounts.length})
            </button>
          </div>
        </div>
        {activeTab === 'assets' && <AssetsView assets={assets} />}
        {activeTab === 'transactions' && <TransactionsView transactions={transactions} accounts={accounts} onAddTransaction={handleAddTransaction} />}
        {activeTab === 'accounts' && <AccountsView accounts={accounts} />}
      </div>
    </div>
  );
}

function AssetsView({ assets }) {
  const summary = useMemo(() => {
    return assets.reduce((acc, asset) => {
      acc.totalValue += asset.currentValueSGD;
      acc.totalPaperPL += asset.paperProfitLoss * (asset.currency === 'SGD' ? 1 : 1.35);
      acc.totalRealizedPL += asset.realizedProfitLossSGD;
      acc.totalPL += asset.totalProfitLossSGD;
      return acc;
    }, { totalValue: 0, totalPaperPL: 0, totalRealizedPL: 0, totalPL: 0 });
  }, [assets]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', minimumFractionDigits: 2 }).format(value);
  };

  if (assets.length === 0) {
    return <div className="text-center py-12 text-slate-600">No assets found. Add transactions to see your portfolio.</div>;
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Total Value</p>
              <p className="text-2xl font-bold text-slate-800">{formatCurrency(summary.totalValue)}</p>
            </div>
            <DollarSign className="text-blue-500" size={32} />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Paper P/L</p>
              <p className={`text-2xl font-bold ${summary.totalPaperPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(summary.totalPaperPL)}</p>
            </div>
            {summary.totalPaperPL >= 0 ? <TrendingUp className="text-green-500" size={32} /> : <TrendingDown className="text-red-500" size={32} />}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Realized P/L</p>
              <p className={`text-2xl font-bold ${summary.totalRealizedPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(summary.totalRealizedPL)}</p>
            </div>
            <PieChart className="text-purple-500" size={32} />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Total P/L</p>
              <p className={`text-2xl font-bold ${summary.totalPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(summary.totalPL)}</p>
            </div>
            <TrendingUp className="text-green-500" size={32} />
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Asset</th>
              <th className="px-4 py-3 text-left font-semibold">Symbol</th>
              <th className="px-4 py-3 text-right font-semibold">Holdings</th>
              <th className="px-4 py-3 text-right font-semibold">Value (SGD)</th>
              <th className="px-4 py-3 text-right font-semibold">P/L</th>
              <th className="px-4 py-3 text-right font-semibold">ROI %</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, idx) => (
              <tr key={idx} className="border-b hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{asset.asset}</td>
                <td className="px-4 py-3 text-slate-600">{asset.symbol}</td>
                <td className="px-4 py-3 text-right">{asset.currentHoldings.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(asset.currentValueSGD)}</td>
                <td className={`px-4 py-3 text-right font-medium ${asset.totalProfitLossSGD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(asset.totalProfitLossSGD)}
                </td>
                <td className={`px-4 py-3 text-right ${asset.roiPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {asset.roiPercent.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionsView({ transactions, accounts, onAddTransaction }) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    date: '', type: 'Buy', asset: '', symbol: '', transactedUnits: '', transactedPrice: '', fees: '0', accountName: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const account = accounts.find(a => a.accountName === formData.accountName);
    if (!account) {
      alert('Please select a valid account');
      return;
    }
    await onAddTransaction({
      ...formData,
      transactedUnits: parseFloat(formData.transactedUnits),
      transactedPrice: parseFloat(formData.transactedPrice),
      fees: parseFloat(formData.fees),
      owner: account.owner
    });
    setShowForm(false);
    setFormData({ date: '', type: 'Buy', asset: '', symbol: '', transactedUnits: '', transactedPrice: '', fees: '0', accountName: '' });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-slate-800">Transaction History</h2>
        <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
          <Plus size={20} />
          Add Transaction
        </button>
      </div>
      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">New Transaction</h3>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Date</label><input type="date" required value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Type</label><select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2"><option>Buy</option><option>Sell</option><option>Dividend</option></select></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Asset Name</label><input type="text" required value={formData.asset} onChange={(e) => setFormData({ ...formData, asset: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Symbol</label><input type="text" required value={formData.symbol} onChange={(e) => setFormData({ ...formData, symbol: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Account</label><select required value={formData.accountName} onChange={(e) => setFormData({ ...formData, accountName: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2"><option value="">Select Account</option>{accounts.map(a => <option key={a.id} value={a.accountName}>{a.accountName} ({a.owner})</option>)}</select></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Units</label><input type="number" step="any" required value={formData.transactedUnits} onChange={(e) => setFormData({ ...formData, transactedUnits: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Price (per unit)</label><input type="number" step="any" required value={formData.transactedPrice} onChange={(e) => setFormData({ ...formData, transactedPrice: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Fees</label><input type="number" step="any" value={formData.fees} onChange={(e) => setFormData({ ...formData, fees: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Add Transaction</button>
              <button type="button" onClick={() => setShowForm(false)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded hover:bg-slate-300">Cancel</button>
            </div>
          </form>
        </div>
      )}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Date</th>
              <th className="px-4 py-3 text-left font-semibold">Type</th>
              <th className="px-4 py-3 text-left font-semibold">Asset</th>
              <th className="px-4 py-3 text-left font-semibold">Symbol</th>
              <th className="px-4 py-3 text-right font-semibold">Units</th>
              <th className="px-4 py-3 text-right font-semibold">Price</th>
              <th className="px-4 py-3 text-left font-semibold">Account</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice().reverse().map((txn) => (
              <tr key={txn.id} className="border-b hover:bg-slate-50">
                <td className="px-4 py-3">{txn.date}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${txn.type === 'Buy' ? 'bg-green-100 text-green-800' : txn.type === 'Sell' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{txn.type}</span>
                </td>
                <td className="px-4 py-3 font-medium">{txn.asset}</td>
                <td className="px-4 py-3 text-slate-600">{txn.symbol}</td>
                <td className="px-4 py-3 text-right">{txn.transactedUnits.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">{txn.transactedPrice.toFixed(2)}</td>
                <td className="px-4 py-3">{txn.accountName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountsView({ accounts }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-800 mb-6">Accounts</h2>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-100 border-b">
            <tr>
              <th className="px-6 py-3 text-left font-semibold">Account Name</th>
              <th className="px-6 py-3 text-left font-semibold">Owner</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id} className="border-b hover:bg-slate-50">
                <td className="px-6 py-4 font-medium">{account.accountName}</td>
                <td className="px-6 py-4">{account.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;