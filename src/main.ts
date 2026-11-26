// Entry point. Kept free of engine imports so the menu paints at once; the game itself is a separate chunk
// that is requested only when the player presses 开始 (or the URL asks for a direct start).

import './ui/hud.css';
import './ui/shell.css';
import { initShell, menuActivate, menuNavigate, togglePause } from './ui/shell';

const canvas = document.getElementById('game') as HTMLCanvasElement;

initShell({
  root: document.getElementById('shell')!,
  canvas,
  params: new URLSearchParams(location.search),
  launch: async (params, progress) => {
    const { startGame } = await import('./game');
    return startGame({ canvas, hud: document.getElementById('hud')!, params, progress,
      onPauseRequest: togglePause, onMenuNavigate: menuNavigate, onMenuAccept: menuActivate,
    });
  },
});
