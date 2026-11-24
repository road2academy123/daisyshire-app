const SAVE_KEY = 'daisyshire-moonlight-save-v1';

const DEFAULT_SAVE = {
  level: 1,
  coins: 150,
  day: 1,
  cafeOpen: false,
  reputation: 0,
  unlockedRecipes: ['Moonlight Latte']
};

export function renderDaisyGame({ root, onEnter }) {
  let save = { ...DEFAULT_SAVE };

  try {
    const stored = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      save = { ...DEFAULT_SAVE, ...stored };
    }
  } catch {}

  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {}
  }

  root.innerHTML = `
    <main class="daisy-game-screen moonlight-screen">
<div class="moonlight-atmosphere">
        <span class="moonlight-orb"></span>
        <span class="moonlight-cloud cloud-one"></span>
        <span class="moonlight-cloud cloud-two"></span>
        <span class="moonlight-sparkle sparkle-one">✦</span>
        <span class="moonlight-sparkle sparkle-two">✧</span>
        <span class="moonlight-sparkle sparkle-three">✦</span>
      </div>

      <div class="moonlight-app">
        <header class="moonlight-topbar">
          <div class="moonlight-brand">
            <div class="moonlight-brand-icon">☾</div>
            <div>
              <span class="moonlight-overline">YOUR LITTLE DREAM</span>
              <h1>Moonlight Café</h1>
            </div>
          </div>
          
          <div class="moonlight-topbar-actions">
            <div class="moonlight-wallet">
            <span>🪙</span>
            <strong id="moonlightCoins">${save.coins}</strong>
          </div>
            <button type="button" class="daisy-secret-entry moonlight-chat-entry"
            id="daisySecretEntry" aria-label="Open Daisyshire" title="Open Daisyshire">🌸</button>
          </div>
        </header>

        <section class="moonlight-profile-strip">
          <div class="moonlight-level">
            <span class="moonlight-avatar">🌷</span>
            <div>
              <strong>Little Café Owner</strong>
              <span>Level <b id="moonlightLevel">${save.level}</b></span>
            </div>
          </div>
          <div class="moonlight-day">
            <span>☀</span> Day <b id="moonlightDay">${save.day}</b>
          </div>
        </section>

        <section class="moonlight-main">
          <div class="moonlight-scene">
            <div class="moonlight-scene-sky">
              <div class="moonlight-window-moon"></div>
              <span class="scene-star scene-star-one">✦</span>
              <span class="scene-star scene-star-two">✧</span>
              <span class="scene-star scene-star-three">·</span>
              <div class="moonlight-window-hill hill-back"></div>
              <div class="moonlight-window-hill hill-front"></div>
            </div>

            <div class="moonlight-scene-sign">
              <span>✧</span> MOONLIGHT <span>✧</span>
              <small>coffee • cakes • little dreams</small>
            </div>

            <div class="moonlight-interior">
              <div class="moonlight-shelf">
                <span>🪴</span><span>☕</span><span>🧁</span><span>🪴</span>
              </div>
              <div class="moonlight-hanging-lamp lamp-one"></div>
              <div class="moonlight-hanging-lamp lamp-two"></div>
              <div class="moonlight-counter">
                <div class="counter-machine">☕</div>
                <div class="counter-cake">🍰</div>
                <div class="counter-jar">🍪</div>
              </div>
              <div class="moonlight-counter-front">
                <span>♡</span> freshly made with love <span>♡</span>
              </div>
              <div class="moonlight-plant plant-left">🪴</div>
              <div class="moonlight-plant plant-right">🌷</div>
            </div>

            <div class="moonlight-scene-floor"></div>
            <div class="moonlight-scene-glow"></div>
          </div>

          <div class="moonlight-welcome">
            <div>
              <span class="moonlight-overline">A NEW LITTLE ADVENTURE</span>
              <h2 id="moonlightGreeting">Your café awaits ♡</h2>
              <p id="moonlightStatus">A quiet little place with big dreams.</p>
            </div>
            <span class="moonlight-welcome-flower">🌸</span>
          </div>

          <button class="moonlight-open-button" id="moonlightOpenButton">
            <span id="moonlightOpenIcon">☕</span>
            <span id="moonlightOpenText">Open your café</span>
            <span class="moonlight-button-arrow">→</span>
          </button>

          <div class="moonlight-quick-stats">
            <div><span>⭐</span><strong id="moonlightReputation">${save.reputation}</strong><small>Reputation</small></div>
            <div><span>📖</span><strong id="moonlightRecipes">${save.unlockedRecipes.length}</strong><small>Recipes</small></div>
            <div><span>🏡</span><strong>1</strong><small>Café</small></div>
          </div>
        </section>

        <section class="moonlight-content-panel" id="moonlightContentPanel">
          <div class="moonlight-section-heading">
            <div>
              <span class="moonlight-overline" id="moonlightPanelEyebrow">YOUR NEXT STEPS</span>
              <h3 id="moonlightPanelTitle">Little goals</h3>
            </div>
            <span class="moonlight-heading-icon" id="moonlightPanelIcon">✧</span>
          </div>
          <div id="moonlightPanelContent" class="moonlight-panel-content">
            <div class="moonlight-goal">
              <span class="moonlight-goal-icon">☕</span>
              <div><strong>Open your café</strong><small>Your first day is waiting!</small></div>
              <span class="moonlight-goal-mark">♡</span>
            </div>
            <div class="moonlight-goal">
              <span class="moonlight-goal-icon">🧁</span>
              <div><strong>Discover new recipes</strong><small>Build your own little menu.</small></div>
              <span class="moonlight-goal-mark">♡</span>
            </div>
            <div class="moonlight-goal">
              <span class="moonlight-goal-icon">🌷</span>
              <div><strong>Make it yours</strong><small>Decorate your dream café.</small></div>
              <span class="moonlight-goal-mark">♡</span>
            </div>
          </div>
        </section>

        <nav class="moonlight-bottom-nav" aria-label="Game navigation">
          <button class="moonlight-nav-item active" data-tab="cafe">
            <span>☕</span><small>Café</small>
          </button>
          <button class="moonlight-nav-item" data-tab="kitchen">
            <span>🥐</span><small>Kitchen</small>
          </button>
          <button class="moonlight-nav-item" data-tab="shop">
            <span>🛍️</span><small>Shop</small>
          </button>
          <button class="moonlight-nav-item" data-tab="collection">
            <span>📚</span><small>Collection</small>
          </button>
          <button class="moonlight-nav-item" data-tab="missions">
            <span>✨</span><small>Missions</small>
          </button>
        </nav>

        <p class="moonlight-footer">made of moonlight & little dreams ♡</p>
      </div>
    </main>
  `;

  const $ = selector => root.querySelector(selector);

  const panels = {
    cafe: {
      eyebrow: 'YOUR NEXT STEPS',
      title: 'Little goals',
      icon: '✧',
      content: `
        <div class="moonlight-goal"><span class="moonlight-goal-icon">☕</span><div><strong>Open your café</strong><small>Your first day is waiting!</small></div><span class="moonlight-goal-mark">♡</span></div>
        <div class="moonlight-goal"><span class="moonlight-goal-icon">🧁</span><div><strong>Discover new recipes</strong><small>Build your own little menu.</small></div><span class="moonlight-goal-mark">♡</span></div>
        <div class="moonlight-goal"><span class="moonlight-goal-icon">🌷</span><div><strong>Make it yours</strong><small>Decorate your dream café.</small></div><span class="moonlight-goal-mark">♡</span></div>
      `
    },
    kitchen: {
      eyebrow: 'THE LITTLE KITCHEN',
      title: 'Recipe book',
      icon: '🥐',
      content: `
        <div class="moonlight-recipe"><span>☕</span><div><strong>Moonlight Latte</strong><small>Starter recipe · Unlocked</small></div><b>✓</b></div>
        <div class="moonlight-recipe locked"><span>🍓</span><div><strong>Strawberry Dream</strong><small>Unlock at level 3</small></div><b>🔒</b></div>
        <div class="moonlight-recipe locked"><span>🧁</span><div><strong>Cloudberry Cupcake</strong><small>Unlock at level 5</small></div><b>🔒</b></div>
        <div class="moonlight-recipe locked"><span>🍵</span><div><strong>Lavender Tea</strong><small>Unlock at level 7</small></div><b>🔒</b></div>
      `
    },
    shop: {
      eyebrow: 'MAKE IT YOURS',
      title: 'Little shop',
      icon: '🛍️',
      content: `
        <div class="moonlight-shop-item"><span>🪑</span><div><strong>Cozy wooden chair</strong><small>Furniture · Coming soon</small></div><b>🪙 80</b></div>
        <div class="moonlight-shop-item"><span>🌷</span><div><strong>Flower table vase</strong><small>Decoration · Coming soon</small></div><b>🪙 45</b></div>
        <div class="moonlight-shop-item"><span>💡</span><div><strong>Fairy lights</strong><small>Lighting · Coming soon</small></div><b>🪙 100</b></div>
      `
    },
    collection: {
      eyebrow: 'YOUR LITTLE MEMORIES',
      title: 'Collection',
      icon: '📚',
      content: `
        <div class="moonlight-collection-item"><span>☕</span><div><strong>First recipe</strong><small>Moonlight Latte discovered</small></div><b>✓</b></div>
        <div class="moonlight-collection-item"><span>🏡</span><div><strong>First café</strong><small>Your journey begins here</small></div><b>✓</b></div>
        <div class="moonlight-collection-item"><span>🐈</span><div><strong>Mystery visitor</strong><small>A little friend is yet to arrive</small></div><b>?</b></div>
      `
    },
    missions: {
      eyebrow: 'SMALL STEPS, BIG DREAMS',
      title: 'Missions',
      icon: '✨',
      content: `
        <div class="moonlight-mission"><span>🌞</span><div><strong>Start your first day</strong><small>Open the café for business</small></div><b>♡</b></div>
        <div class="moonlight-mission"><span>☕</span><div><strong>Serve your first customer</strong><small>Customer gameplay unlocks next</small></div><b>♡</b></div>
        <div class="moonlight-mission"><span>⭐</span><div><strong>Reach level 2</strong><small>Keep growing your café</small></div><b>♡</b></div>
      `
    }
  };

  function renderTab(tab) {
    const panel = panels[tab] || panels.cafe;
    $('#moonlightPanelEyebrow').textContent = panel.eyebrow;
    $('#moonlightPanelTitle').textContent = panel.title;
    $('#moonlightPanelIcon').textContent = panel.icon;
    $('#moonlightPanelContent').innerHTML = panel.content;

    root.querySelectorAll('.moonlight-nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
  }

  root.querySelectorAll('.moonlight-nav-item').forEach(button => {
    button.addEventListener('click', () => renderTab(button.dataset.tab));
  });

  function updateDisplay() {
    $('#moonlightCoins').textContent = save.coins;
    $('#moonlightLevel').textContent = save.level;
    $('#moonlightDay').textContent = save.day;
    $('#moonlightReputation').textContent = save.reputation;
    $('#moonlightRecipes').textContent = save.unlockedRecipes.length;

    $('#moonlightOpenText').textContent = save.cafeOpen
      ? 'Close for today'
      : 'Open your café';

    $('#moonlightOpenIcon').textContent = save.cafeOpen ? '🌙' : '☕';
    $('#moonlightGreeting').textContent = save.cafeOpen
      ? 'Your café is open! ♡'
      : 'Your café awaits ♡';

    $('#moonlightStatus').textContent = save.cafeOpen
      ? 'The lights are on. Let the little adventure begin!'
      : 'A quiet little place with big dreams.';

    $('#moonlightOpenButton').classList.toggle('is-open', save.cafeOpen);
  }

  $('#moonlightOpenButton').addEventListener('click', () => {
    if (save.cafeOpen) {
      save.cafeOpen = false;
      save.day += 1;
    } else {
      save.cafeOpen = true;
    }

    persist();
    updateDisplay();
  });

  $('#daisySecretEntry').addEventListener('click', () => {
    cleanup();
    onEnter();
  });

  let cleaned = false;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
  }

  updateDisplay();
  renderTab('cafe');
  persist();

  return cleanup;
}
