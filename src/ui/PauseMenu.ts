import { h } from './dom';
import { Screen, button, controlsTable, type UiSounds } from './Screen';

export class PauseMenu extends Screen {
  constructor(sounds: UiSounds, actions: { resume(): void; restart(): void; settings(): void; quit(): void }) {
    super('pause-menu');
    this.el.append(
      h('div', { class: 'pause-layout' },
        h('div', { class: 'pause-col' },
          h('h2', { class: 'screen-title' }, 'PAUSED'),
          h('nav', { class: 'menu-buttons' },
            button('RESUME', actions.resume, sounds, { primary: true }),
            button('RESTART', actions.restart, sounds),
            button('SETTINGS', actions.settings, sounds),
            button('QUIT TO MENU', actions.quit, sounds),
          ),
        ),
        h('div', { class: 'panel' }, h('h3', {}, 'CONTROLS'), controlsTable()),
      ),
    );
  }
}
