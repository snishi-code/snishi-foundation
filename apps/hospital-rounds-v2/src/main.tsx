import { createRoot } from 'react-dom/client';
import { useServiceWorker } from '@snishi/foundation/pwa/useServiceWorker';
import '@snishi/foundation/ui/tokens.css';
import '@snishi/foundation/ui/foundation.css';
import '@snishi/foundation/ui/components.css';
import './app.css';
import { App } from './App';

function Root() {
  // 凍結 SW ポリシー (仕様§10): 登録のみ。本番のみ register / dev・test では no-op。
  useServiceWorker('./sw.js');
  return <App />;
}

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(<Root />);
