import React, { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, PieChart, RefreshCw, Plus } from 'lucide-react';
import { GOOGLE_CONFIG } from './config';

function App() {
  const [activeTab, setActiveTab] = useState('assets');
  const [masterAssets, setMasterAssets] = useState([]);
  const [calculatedAssets, setCalculatedAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState(null);
  const [prices, setPrices] = useState({});

  useEffect(() => {
    console.log('App mounting...');
    
    if (GOOGLE_CONFIG.CLIENT_ID.includes('YOUR_CLIENT_ID') || 
        GOOGLE_CONFIG.API_KEY.includes('YOUR_API_KEY')) {
      setError('Google credentials not configured in config.js');
      setIsLoading(false);
      return;
    }

    const initGoogleAPIs = async () => {
      try {
        await new Promise((resolve) => {
          let attempts = 0;
          const checkGapi = setInterval(() => {
            attempts++;
            if (window.gapi && window.google) {
              console.log('Google APIs loaded');
              clearInterval(checkGapi);
              resolve();
            } else if (attempts > 50) {
              clearInterval(checkGapi);
              resolve();
            }
          }, 100);
        });

        if (window.gapi) {
          await new Promise((resolve) => {
            window.gapi.load('client', resolve);
          });
          
          await window.gapi.client.init({
            apiKey: GOOGLE_CONFIG.API_KEY,
            discoveryDocs: [GOOGLE_CONFIG.DISCOVERY_DOC],
          });
        }

        setIsLoading(false);
      } catch (err) {
        setError('Failed to initialize');
        setIsLoading(false);
      }
    };

    initGoogleAPIs();
  }, []);

  const handleSignInWithToken = () => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: GOOGLE_CONFIG.SCOPES,
      callback: async (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          window.gapi.client.setToken({ access_token: tokenResponse.access_token });
          setIsAuthenticated(true);
          await loadData();
        }
      },
    });
    
    const token = window.gapi.client.getToken();
    if (token === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  };

  const loadData = async () => {
    try {
      setIsLoading(true);
      
      // Load master assets from Assets sheet
      const assetsData = await readSheet('assets!A2:F');
      const loadedAssets = assetsData.map((row, idx) => ({
        id: idx + 1,
        name: row[0] || '',
        symbol: (row[1] || '').toUpperCase().trim(),
        portfolio: row[2] || '',
        category: row[3] || '',
        exchange: row[4] || '',
        currency: row[5] || 'USD'
      }));
      setMasterAssets(loadedAssets);

      // Load accounts
      const accountsData = await readSheet('accounts!A2:B');
      const loadedAccounts = accountsData.map((row, idx) => ({
        id: idx + 1,
        accountName: row[0] || '',
        owner: row[1] || ''
      }));
      setAccounts(loadedAccounts);

      // Load transactions
      const transactionsData = await readSheet('transactions!A2:H');
      const loadedTransactions = transactionsData.map((row, idx) => {
        const account = loadedAccounts.find(a => a.accountName === row[7]);
        return {
          id: idx + 1,
          date: parseDate(row[0] || ''),
          type: row[1] || '',
          asset: row[2] || '',
          symbol: (row[3] || '').toUpperCase().trim(),
          transactedUnits: parseFloat(row[4]) || 0,
          transactedPrice: parseFloat(row[5]) || 0,
          fees: parseFloat(row[6]) || 0,
          accountName: row[7] || '',
          owner: account?.owner || ''
        };
      });
      setTransactions(loadedTransactions);

      // Fetch prices for all assets
      await fetchPrices(loadedAssets);
      
      // Calculate asset metrics from transactions
      calculateAssets(loadedAssets, loadedTransactions);
      
      setIsLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load data: ' + err.message);
      setIsLoading(false);
    }
  };

  const readSheet = async (range) => {
    const response = await window.gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_CONFIG.SPREADSHEET_ID,
      range: range,
    });
    return response.result.values || [];
  };

  const writeSheet = async (range, values) => {
    const response = await window.gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_CONFIG.SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: values },
    });
    return response.result;
  };

  const parseDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dateStr;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const fetchPrices = async (assets) => {
    const priceMap = {};
    
    for (const asset of assets) {
      try {
        let price = 100; // Default fallback
        
        if (asset.category === 'Crypto') {
          // Use CoinGecko for crypto
          const coinId = asset.symbol.toLowerCase();
          const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
          const data = await response.json();
          if (data[coinId]?.usd) {
            price = data[coinId].usd;
          }
        } else {
          // Use Yahoo Finance for stocks/bonds
          const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${asset.symbol}`);
          const data = await response.json();
          if (data.chart?.result?.[0]?.meta?.regularMarketPrice) {
            price = data.chart.result[0].meta.regularMarketPrice;
          }
        }
        
        priceMap[asset.symbol] = price;
      } catch (err) {
        console.error(`Error fetching price for ${asset.symbol}:`, err);
        priceMap[asset.symbol] = 100; // Fallback
      }
    }
    
    setPrices(priceMap);
  };

  const calculateAssets = (assets, txns) => {
    const calculated = assets.map(asset => {
      const assetTxns = txns.filter(t => t.symbol === asset.symbol);
      
      let currentHoldings = 0;
      let cumulativeHoldings = 0;
      let costOfCurrentHoldings = 0;
      let cumulativeCost = 0;
      let realizedPL = 0;
      let dividends = 0;

      assetTxns.sort((a, b) => new Date(a.date) - new Date(b.date));

      assetTxns.forEach(txn => {
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

      const currentPrice = prices[asset.symbol] || 100;
      const costPerUnit = currentHoldings > 0 ? costOfCurrentHoldings / currentHoldings : 0;
      const currentValue = currentHoldings * currentPrice;
      const paperProfitLoss = currentValue - costOfCurrentHoldings;
      const paperProfitLossPercent = costOfCurrentHoldings > 0 ? (paperProfitLoss / costOfCurrentHoldings) * 100 : 0;
      const sgdRate = asset.currency === 'SGD' ? 1 : 1.35;
      
      return {
        ...asset,
        currentPrice,
        currentHoldings,
        cumulativeHoldings,
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
        totalProfitLossSGD: (paperProfitLoss + realizedPL + dividends) * sgdRate,
        roiPercent: cumulativeCost > 0 ? ((paperProfitLoss + realizedPL + dividends) / cumulativeCost) * 100 : 0
      };
    });

    setCalculatedAssets(calculated);
  };

  const handleAddTransaction = async (transaction) => {
    try {
      const row = [
        formatDate(transaction.date),
        transaction.type,
        transaction.asset,
        transaction.symbol.toUpperCase(),
        transaction.transactedUnits,
        transaction.transactedPrice,
        transaction.fees,
        transaction.accountName
      ];
      
      await writeSheet('transactions!A:H', [row]);
      
      // If new asset, add to Assets sheet
      if (transaction.isNewAsset) {
        const assetRow = [
          transaction.asset,
          transaction.symbol.toUpperCase(),
          transaction.portfolio || 'General',
          transaction.category || 'Stock',
          transaction.exchange || '',
          transaction.currency || 'USD'
        ];
        await writeSheet('assets!A:F', [assetRow]);
      }
      
      await loadData();
    } catch (err) {
      console.error('Error adding transaction:', err);
      setError('Failed to add transaction');
    }
  };

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
          <button onClick={handleSignInWithToken} className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-semibold w-full">
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
              Assets ({calculatedAssets.length})
            </button>
            <button onClick={() => setActiveTab('transactions')} className={`px-6 py-3 font-semibold ${activeTab === 'transactions' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'}`}>
              Transactions ({transactions.length})
            </button>
            <button onClick={() => setActiveTab('accounts')} className={`px-6 py-3 font-semibold ${activeTab === 'accounts' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600'}`}>
              Accounts ({accounts.length})
            </button>
          </div>
        </div>

        {activeTab === 'assets' && <AssetsView assets={calculatedAssets} />}
        {activeTab === 'transactions' && <TransactionsView transactions={transactions} accounts={accounts} masterAssets={masterAssets} onAddTransaction={handleAddTransaction} />}
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
    return <div className="text-center py-12 text-slate-600">No assets found. Add assets and transactions to see your portfolio.</div>;
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
              <th className="px-4 py-3 text-left font-semibold">Portfolio</th>
              <th className="px-4 py-3 text-right font-semibold">Price</th>
              <th className="px-4 py-3 text-right font-semibold">Holdings</th>
              <th className="px-4 py-3 text-right font-semibold">Value (SGD)</th>
              <th className="px-4 py-3 text-right font-semibold">Total P/L</th>
              <th className="px-4 py-3 text-right font-semibold">ROI %</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, idx) => (
              <tr key={idx} className="border-b hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{asset.name}</td>
                <td className="px-4 py-3 text-slate-600">{asset.symbol}</td>
                <td className="px-4 py-3"><span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">{asset.portfolio}</span></td>
                <td className="px-4 py-3 text-right">{asset.currentPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">{asset.currentHoldings.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium">{new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(asset.currentValueSGD)}</td>
                <td className={`px-4 py-3 text-right font-medium ${asset.totalProfitLossSGD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(asset.totalProfitLossSGD)}
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

function TransactionsView({ transactions, accounts, masterAssets, onAddTransaction }) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    date: '', type: 'Buy', symbol: '', asset: '', transactedUnits: '', transactedPrice: '', fees: '0', accountName: '',
    isNewAsset: false, portfolio: '', category: '', exchange: '', currency: 'USD'
  });

  const handleSymbolChange = (e) => {
    const symbol = e.target.value.toUpperCase();
    const existingAsset = masterAssets.find(a => a.symbol === symbol);
    
    if (existingAsset) {
      setFormData({
        ...formData,
        symbol,
        asset: existingAsset.name,
        portfolio: existingAsset.portfolio,
        category: existingAsset.category,
        exchange: existingAsset.exchange,
        currency: existingAsset.currency,
        isNewAsset: false
      });
    } else {
      setFormData({ ...formData, symbol, isNewAsset: true });
    }
  };

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
    setFormData({
      date: '', type: 'Buy', symbol: '', asset: '', transactedUnits: '', transactedPrice: '', fees: '0', accountName: '',
      isNewAsset: false, portfolio: '', category: '', exchange: '', currency: 'USD'
    });
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
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Symbol</label><input type="text" required value={formData.symbol} onChange={handleSymbolChange} className="w-full border border-slate-300 rounded px-3 py-2" placeholder="e.g., AAPL" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Asset Name</label><input type="text" required value={formData.asset} onChange={(e) => setFormData({ ...formData, asset: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" disabled={!formData.isNewAsset} /></div>
              
              {formData.isNewAsset && (
                <>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Portfolio</label><input type="text" value={formData.portfolio} onChange={(e) => setFormData({ ...formData, portfolio: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Category</label><input type="text" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Exchange</label><input type="text" value={formData.exchange} onChange={(e) => setFormData({ ...formData, exchange: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Currency</label><input type="text" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
                </>
              )}
              
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Account</label><select required value={formData.accountName} onChange={(e) => setFormData({ ...formData, accountName: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2"><option value="">Select Account</option>{accounts.map(a => <option key={a.id} value={a.accountName}>{a.accountName} ({a.owner})</option>)}</select></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Units</label><input type="number" step="any" required value={formData.transactedUnits} onChange={(e) => setFormData({ ...formData, transactedUnits: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Price (per unit)</label><input type="number" step="any" required value={formData.transactedPrice} onChange={(e) => setFormData({ ...formData, transactedPrice: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Fees</label><input type="number" step="any" value={formData.fees} onChange={(e) => setFormData({ ...formData, fees: e.target.value })} className="w-full border border-slate-300 rounded px-3 py-2" /></div>
            </div>
            {formData.isNewAsset && <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded mb-4 text-sm">This is a new asset and will be added to your Assets sheet.</div>}
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