import { createRoot } from 'react-dom/client';
import '@snishi/foundation/ui/tokens.css';
import '@snishi/foundation/ui/foundation.css';
import '@snishi/foundation/ui/components.css';
import './app.css';
import { App } from './App';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(<App />);
