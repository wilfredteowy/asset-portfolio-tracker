import React, { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, PieChart, RefreshCw, Plus } from 'lucide-react';
import { GOOGLE_CONFIG } from './config';

function App() {
  const [activeTab, setActiveTab] = useState('assets');
  const [assets, setAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState(null);
  const [accessToken, setAccessToken] = useState(null);

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
              console.error('Timeout waiting for Google APIs');
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
          console.log('GAPI client initialized');
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Error initializing APIs:', err);
        setError('Failed to initialize: ' + err.message);
        setIsLoading(false);
      }
    };

    initGoogleAPIs();
  }, []);

  const handleSignIn = () => {
    console.log('Initiating sign in...');
    
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: GOOGLE_CONFIG.SCOPES,
      ux_mode: 'redirect',
      redirect_uri: window.location.origin,
    });
    
    client.requestCode();
  };

  // Check for OAuth code in URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      console.log('OAuth code found, exchanging for token...');
      // In a real app, you'd exchange this code for a token on your backend
      // For now, we'll use a simpler token-based flow
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleSignInWithToken = () => {
    console.log('Starting token-based auth...');
    
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: GOOGLE_CONFIG.SCOPES,
      callback: async (tokenResponse) => {
        console.log('Token received');
        if (tokenResponse && tokenResponse.access_token) {
          setAccessToken(tokenResponse.access_token);
          window.gapi.client.setToken({ access_token: tokenResponse.access_token });
          setIsAuthenticated(true);
          await loadData();
        }
      },
    });
    
    // Check if we already have a token
    const token = window.gapi.client.getToken();
    if (token === null) {
      console.log('Requesting new token...');
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      console.log('Using existing token...');
      tokenClient.requestAccessToken({ prompt: '' });
    }
  };

  const loadData = async () => {
    try {
      console.log('Loading data from sheets...');
      setIsLoading(true);
      
      const accountsData = await readSheet('accounts!A2:B');
      const loadedAccounts = accountsData.map((row, idx) => ({
        id: idx + 1,
        accountName: row[0] || '',
        owner: row[1] || ''
      }));
      setAccounts(loadedAccounts);

      const transactionsData = await readSheet('transactions!A2:H');
      const loadedTransactions = transactionsData.map((row, idx) => {
        const account = loadedAccounts.find(a => a.accountName === row[7]);
        return {
          id: idx + 1,
          date: parseDate(row[0] || ''),
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
      
      console.log(`Loaded ${loadedAccounts.length} accounts and ${loadedTransactions.length} transactions`);
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

  const parseDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dateStr;
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
        currency: assetData.currency,
        currentPrice: assetData.currentPrice,
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

    setAssets(calculatedAssets);
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
          <p className="text-slate-600 mb-6">Sign in with your Google account to access your portfolio data from Google Sheets.</p>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>}
          <button 
            onClick={handleSignInWithToken} 
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-semibold w-full mb-3"
          >
            Sign in with Google
          </button>
          <p className="text-xs text-slate-500">
            This will open a popup to authorize access to your Google Sheets
          </p>
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
        {activeTab === 'transactions' && <TransactionsView transactions={transactions} />}
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
              <th className="px-4 py-3 text-right font-semibold">Total P/L</th>
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

function TransactionsView({ transactions }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-800 mb-6">Transaction History</h2>
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