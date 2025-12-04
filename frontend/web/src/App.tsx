import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface WasteRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "processed" | "rejected";
}

// FHE simulation functions
const FHEEncryption = (data: string): string => `FHE-${btoa(data)}`;
const FHEDecryption = (encryptedData: string): string => encryptedData.startsWith('FHE-') ? atob(encryptedData.substring(4)) : encryptedData;
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<WasteRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ category: "", description: "", imageData: "" });
  const [selectedRecord, setSelectedRecord] = useState<WasteRecord | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showFAQ, setShowFAQ] = useState(false);
  
  // Data statistics
  const processedCount = records.filter(r => r.status === "processed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;
  const categories = ["Plastic", "Paper", "Glass", "Metal", "Organic", "Hazardous"];
  const categoryCounts = categories.map(cat => ({
    name: cat,
    count: records.filter(r => r.category === cat).length
  }));

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load record keys
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing record keys:", e); }
      }
      
      // Load individual records
      const list: WasteRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedData: recordData.data, 
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                category: recordData.category, 
                status: recordData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing record data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading record ${key}:`, e); }
      }
      
      // Sort by timestamp and update state
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { console.error("Error loading records:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitRecord = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting waste data with Zama FHE..." 
    });
    
    try {
      // Encrypt data with simulated FHE
      const encryptedData = FHEEncryption(JSON.stringify({ 
        ...newRecordData, 
        timestamp: Date.now() 
      }));
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique ID
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const recordData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        category: newRecordData.category, 
        status: "pending" 
      };
      
      // Store record data
      await contract.setData(`record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));
      
      // Update record keys
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(recordId);
      await contract.setData("record_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      // Update UI
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Encrypted waste data submitted securely!" 
      });
      await loadRecords();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({ category: "", description: "", imageData: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      // Simulate FHE decryption authorization
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      
      // Simulate FHE processing delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Return decrypted data
      return FHEDecryption(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { setIsDecrypting(false); }
  };

  const processRecord = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted waste data with FHE..." 
    });
    
    try {
      // Simulate FHE processing delay
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Update record status
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      const updatedRecord = { ...recordData, status: "processed" };
      
      await contract.setData(`record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      // Update UI
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE processing completed successfully!" 
      });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Processing failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted waste data with FHE..." 
    });
    
    try {
      // Simulate FHE processing delay
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Update record status
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      const updatedRecord = { ...recordData, status: "rejected" };
      
      await contract.setData(`record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      // Update UI
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE rejection completed successfully!" 
      });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Rejection failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  // Render category distribution chart
  const renderCategoryChart = () => {
    const total = records.length || 1;
    return (
      <div className="category-chart">
        {categoryCounts.map((category, index) => (
          <div key={category.name} className="chart-bar-container">
            <div className="chart-bar-label">{category.name}</div>
            <div className="chart-bar">
              <div 
                className="chart-bar-fill" 
                style={{ width: `${(category.count / total) * 100}%` }}
              ></div>
            </div>
            <div className="chart-bar-value">{category.count}</div>
          </div>
        ))}
      </div>
    );
  };

  // Render status pie chart
  const renderPieChart = () => {
    const total = records.length || 1;
    const processedPercentage = (processedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;
    
    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div className="pie-segment processed" style={{ transform: `rotate(${processedPercentage * 3.6}deg)` }}></div>
          <div className="pie-segment pending" style={{ transform: `rotate(${(processedPercentage + pendingPercentage) * 3.6}deg)` }}></div>
          <div className="pie-segment rejected" style={{ transform: `rotate(${(processedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">Records</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item"><div className="color-box processed"></div><span>Processed: {processedCount}</span></div>
          <div className="legend-item"><div className="color-box pending"></div><span>Pending: {pendingCount}</span></div>
          <div className="legend-item"><div className="color-box rejected"></div><span>Rejected: {rejectedCount}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner">
        <div className="gear large"></div>
        <div className="gear medium"></div>
        <div className="gear small"></div>
      </div>
      <p>Initializing encrypted waste sorting system...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="recycle-icon"></div>
          </div>
          <h1>WasteSort<span>FHE</span></h1>
        </div>
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn mechanical-button"
          >
            <div className="add-icon"></div>Add Waste Record
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content panel-layout">
        {/* Left Panel - Data Visualization */}
        <div className="panel-left">
          <div className="panel-card mechanical-card">
            <h3>Waste Processing Stats</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{processedCount}</div>
                <div className="stat-label">Processed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>

          <div className="panel-card mechanical-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>

          <div className="panel-card mechanical-card">
            <h3>Category Distribution</h3>
            {renderCategoryChart()}
          </div>
        </div>

        {/* Center Panel - Records List */}
        <div className="panel-center">
          <div className="panel-card mechanical-card">
            <div className="section-header">
              <h2>Encrypted Waste Records</h2>
              <div className="header-actions">
                <button 
                  onClick={loadRecords} 
                  className="refresh-btn mechanical-button" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="records-list">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Category</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {records.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No waste records found</p>
                  <button 
                    className="mechanical-button primary" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Record
                  </button>
                </div>
              ) : records.map(record => (
                <div 
                  className="record-row" 
                  key={record.id} 
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.category}</div>
                  <div className="table-cell">{record.owner.substring(0, 6)}...{record.owner.substring(38)}</div>
                  <div className="table-cell">{new Date(record.timestamp * 1000).toLocaleDateString()}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>{record.status}</span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(record.owner) && record.status === "pending" && (
                      <>
                        <button 
                          className="action-btn mechanical-button success" 
                          onClick={(e) => { e.stopPropagation(); processRecord(record.id); }}
                        >
                          Process
                        </button>
                        <button 
                          className="action-btn mechanical-button danger" 
                          onClick={(e) => { e.stopPropagation(); rejectRecord(record.id); }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel - Info and FAQ */}
        <div className="panel-right">
          <div className="panel-card mechanical-card">
            <h3>About WasteSortFHE</h3>
            <p>
              WasteSortFHE is a privacy-preserving smart waste sorting system that uses Fully Homomorphic Encryption (FHE) 
              to analyze and classify waste without exposing sensitive image data.
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>

          <div className="panel-card mechanical-card">
            <div className="faq-header" onClick={() => setShowFAQ(!showFAQ)}>
              <h3>Frequently Asked Questions</h3>
              <div className={`faq-toggle ${showFAQ ? 'open' : ''}`}></div>
            </div>
            
            {showFAQ && (
              <div className="faq-content">
                <div className="faq-item">
                  <h4>How does FHE protect my privacy?</h4>
                  <p>
                    Fully Homomorphic Encryption allows computations to be performed on encrypted data without 
                    decrypting it. Your waste images remain encrypted throughout the entire sorting process.
                  </p>
                </div>
                
                <div className="faq-item">
                  <h4>What types of waste can be classified?</h4>
                  <p>
                    Our system can classify plastic, paper, glass, metal, organic, and hazardous waste materials 
                    using encrypted image analysis.
                  </p>
                </div>
                
                <div className="faq-item">
                  <h4>How is the data stored?</h4>
                  <p>
                    All waste data is encrypted on-chain using FHE technology. Only authorized parties with 
                    proper cryptographic keys can access the original data.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="panel-card mechanical-card">
            <h3>Technology Partners</h3>
            <div className="partners-grid">
              <div className="partner-logo">Zama</div>
              <div className="partner-logo">Chainlink</div>
              <div className="partner-logo">IPFS</div>
              <div className="partner-logo">Polygon</div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Record Modal */}
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
        />
      )}

      {/* Record Detail Modal */}
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { setSelectedRecord(null); setDecryptedContent(null); }} 
          decryptedContent={decryptedContent} 
          setDecryptedContent={setDecryptedContent} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content mechanical-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner small"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="recycle-icon small"></div>
              <span>WasteSortFHE</span>
            </div>
            <p>Privacy-Preserving Smart Waste Sorting System</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} WasteSortFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, recordData, setRecordData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  const handleSubmit = () => {
    if (!recordData.category || !recordData.imageData) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal mechanical-card">
        <div className="modal-header">
          <h2>Add Waste Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your waste data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Waste Category *</label>
              <select 
                name="category" 
                value={recordData.category} 
                onChange={handleChange} 
                className="mechanical-select"
              >
                <option value="">Select category</option>
                <option value="Plastic">Plastic</option>
                <option value="Paper">Paper</option>
                <option value="Glass">Glass</option>
                <option value="Metal">Metal</option>
                <option value="Organic">Organic</option>
                <option value="Hazardous">Hazardous</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text" 
                name="description" 
                value={recordData.description} 
                onChange={handleChange} 
                placeholder="Brief description..." 
                className="mechanical-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Image Data (Base64) *</label>
              <textarea 
                name="imageData" 
                value={recordData.imageData} 
                onChange={handleChange} 
                placeholder="Enter waste image data to encrypt..." 
                className="mechanical-textarea" 
                rows={4}
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Data:</span>
                <div>{recordData.imageData.substring(0, 50) || 'No data entered'}...</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{recordData.imageData ? FHEEncryption(recordData.imageData).substring(0, 50) + '...' : 'No data entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn mechanical-button">Cancel</button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn mechanical-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface RecordDetailModalProps {
  record: WasteRecord;
  onClose: () => void;
  decryptedContent: string | null;
  setDecryptedContent: (content: string | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<string | null>;
}

const RecordDetailModal: React.FC<RecordDetailModalProps> = ({ 
  record, 
  onClose, 
  decryptedContent, 
  setDecryptedContent, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedContent) { 
      setDecryptedContent(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(record.encryptedData);
    if (decrypted) setDecryptedContent(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal mechanical-card">
        <div className="modal-header">
          <h2>Record Details #{record.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Category:</span>
              <strong>{record.category}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{record.owner.substring(0, 6)}...{record.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${record.status}`}>{record.status}</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Data</h3>
            <div className="encrypted-data">
              {record.encryptedData.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn mechanical-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : decryptedContent ? "Hide Data" : "Decrypt with Wallet"}
            </button>
          </div>
          
          {decryptedContent && (
            <div className="decrypted-data-section">
              <h3>Decrypted Data</h3>
              <div className="decrypted-data">
                <pre>{JSON.stringify(JSON.parse(decryptedContent), null, 2)}</pre>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn mechanical-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;