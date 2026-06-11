import { createRoot } from 'react-dom/client';
import { FOUNDATION_VERSION } from '@snishi/foundation';

function App() {
  return <main>simple-ledger-v2 scaffold (foundation {FOUNDATION_VERSION})</main>;
}

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(<App />);
