export default function Home() {
  return (
    <main style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: '#f5f5f5',
      padding: '2rem',
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
        🎧 Audico WhatsApp Agent
      </h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        AI-powered sales assistant
      </p>
      <div style={{ 
        backgroundColor: 'white', 
        padding: '2rem', 
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        maxWidth: '400px',
        textAlign: 'center',
      }}>
        <p style={{ marginBottom: '1rem' }}>
          <strong>Status:</strong> ✅ Online
        </p>
        <p style={{ fontSize: '0.9rem', color: '#666' }}>
          Webhook endpoint: <code>/api/webhook</code>
        </p>
        <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
          Health check: <code>/api/health</code>
        </p>
      </div>
    </main>
  );
}
