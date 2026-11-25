import './style.css';
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Media } from '@capacitor-community/media';
import { createDaisyshireCallController } from './video-call.js';
import { renderDaisyGame } from './game.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  document.querySelector('#app').textContent =
    'Supabase configuration missing. Check .env.local';
  throw new Error('Missing Supabase configuration');
}

const supabase = createClient(url, key);
const app = document.querySelector('#app');

// DAISYSHIRE PHOTO AND VIDEO DOWNLOADS
let daisyshireAlbumIdentifierPromise = null;

async function getDaisyshireAlbumIdentifier() {
  if (!daisyshireAlbumIdentifierPromise) {
    daisyshireAlbumIdentifierPromise = (async () => {
      const findAlbum = async () => {
        const result = await Media.getAlbums();
        return result.albums?.find(
          album => album.name?.toLowerCase() === 'daisyshire'
        );
      };

      let album = await findAlbum();

      if (album?.identifier) {
        return album.identifier;
      }

      try {
        await Media.createAlbum({ name: 'Daisyshire' });
      } catch (createError) {
        // The album may have been created already.
        album = await findAlbum();

        if (album?.identifier) {
          return album.identifier;
        }

        throw createError;
      }

      album = await findAlbum();

      if (!album?.identifier) {
        throw new Error('Could not find the Daisyshire album.');
      }

      return album.identifier;
    })();
  }

  try {
    return await daisyshireAlbumIdentifierPromise;
  } catch (error) {
    daisyshireAlbumIdentifierPromise = null;
    throw error;
  }
}

function createMediaDownloadButton(mediaUrl, mediaType, originalName) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'daisy-media-download';
  button.textContent = '↓ Download';
  button.setAttribute(
    'aria-label',
    `Download ${mediaType === 'image' ? 'photo' : 'video'}`
  );

  button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();

    if (button.disabled) return;

    const originalLabel = '↓ Download';
    button.disabled = true;
    button.classList.add('is-saving');
    button.textContent = '◌ Saving...';

    try {
      const safeBaseName = String(
        originalName ||
        `Daisyshire-${mediaType}-${Date.now()}`
      )
        .split(/[\\/]/)
        .pop()
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 65) || `Daisyshire-${Date.now()}`;

      if (
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === 'android'
      ) {
        const albumIdentifier = await getDaisyshireAlbumIdentifier();

        const options = {
          path: mediaUrl,
          albumIdentifier,
          fileName: `${safeBaseName}_${Date.now()}`
        };

        if (mediaType === 'image') {
          await Media.savePhoto(options);
        } else {
          await Media.saveVideo(options);
        }
      } else {
        const response = await fetch(mediaUrl);

        if (!response.ok) {
          throw new Error('Media download failed.');
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        const extensionFromName = originalName?.match(/\.[a-zA-Z0-9]+$/)?.[0];
        const mimeExtension = blob.type.split('/')[1]?.split(';')[0];
        const extension = extensionFromName ||
          (mimeExtension ? `.${mimeExtension === 'jpeg' ? 'jpg' : mimeExtension}` :
            mediaType === 'image' ? '.jpg' : '.mp4');

        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `${safeBaseName}${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      }

      button.textContent = '✓ Saved';
      button.classList.remove('is-saving');
      button.classList.add('is-saved');

      setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove('is-saved');
        button.disabled = false;
      }, 1800);

    } catch (error) {
      console.error('Daisyshire media download failed:', error);

      button.textContent = '↻ Try again';
      button.classList.remove('is-saving');
      button.classList.add('is-download-error');
      button.disabled = false;
    }
  };

  return button;
}


// DAISYSHIRE ANDROID CHROME KEYBOARD ADAPTATION
function updateDaisyChatViewport() {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  const top = viewport ? viewport.offsetTop : 0;
  const width = viewport ? viewport.width : window.innerWidth;
  const left = viewport ? viewport.offsetLeft : 0;

  document.documentElement.style.setProperty(
    '--daisy-chat-width',
    Math.max(1, width) + 'px'
  );

  document.documentElement.style.setProperty(
    '--daisy-chat-left',
    Math.max(0, left) + 'px'
  );

  document.documentElement.style.setProperty(
    '--daisy-chat-height',
    Math.max(1, height) + 'px'
  );

  document.documentElement.style.setProperty(
    '--daisy-chat-top',
    Math.max(0, top) + 'px'
  );
}

updateDaisyChatViewport();

window.addEventListener('resize', updateDaisyChatViewport);

if (window.visualViewport) {
  window.visualViewport.addEventListener(
    'resize',
    updateDaisyChatViewport
  );

  window.visualViewport.addEventListener(
    'scroll',
    updateDaisyChatViewport
  );
}

window.addEventListener('orientationchange', () => {
  setTimeout(updateDaisyChatViewport, 150);
});


let currentScreen = 'login';
let currentUser = null;
let conversationId = null;
let chatChannel = null;
let presenceChannel = null;
let profileChannel = null;
let typingChannel = null;
let typingChannelReady = false;
let typingStopTimer = null;
let remoteTypingTimer = null;
let lastTypingBroadcast = 0;
let onlineUserIds = new Set();
let busy = false;
let replyingToMessage = null;
let hiddenMessageIds = new Set();
let ownProfile = null;
let otherProfile = null;
let videoCallController = null;

const MAX_MEDIA_SIZE = 50 * 1024 * 1024;
const SIGNED_URL_SECONDS = 3600;

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

let messageReceiptCache = new Map();

let oldestLoadedMessage = null;
let hasMoreMessages = true;
let loadingOlderMessages = false;
const MESSAGE_PAGE_SIZE = 40;
let receiptVisibilityHandlerAttached = false;

function updateMessageReceiptUI(messageId, receipt) {
  const row = document.querySelector(
    '[data-message-id="' + messageId + '"]'
  );
  const indicator = row?.querySelector('.message-receipt');

  if (!indicator) return;

  if (receipt?.seen_at) {
    indicator.textContent = '✓✓ Seen';
    indicator.dataset.state = 'seen';
  } else if (receipt?.delivered_at) {
    indicator.textContent = '✓✓ Delivered';
    indicator.dataset.state = 'delivered';
  } else {
    indicator.textContent = '✓ Sent';
    indicator.dataset.state = 'sent';
  }
}

async function markIncomingMessageReceipt(message, markSeen = false) {
  if (!currentUser || message.sender_id === currentUser.id) return;

  const now = new Date().toISOString();

  const { data: existing, error: selectError } = await supabase
    .from('message_receipts')
    .select('*')
    .eq('message_id', message.id)
    .maybeSingle();

  if (selectError) {
    console.error('Receipt lookup failed:', selectError);
    return;
  }

  let result;

  if (!existing) {
    result = await supabase
      .from('message_receipts')
      .insert({
        message_id: message.id,
        recipient_id: currentUser.id,
        delivered_at: now,
        seen_at: markSeen ? now : null
      })
      .select()
      .single();
  } else {
    const changes = {};

    if (!existing.delivered_at) changes.delivered_at = now;
    if (markSeen && !existing.seen_at) changes.seen_at = now;

    if (!Object.keys(changes).length) {
      messageReceiptCache.set(message.id, existing);
      return;
    }

    result = await supabase
      .from('message_receipts')
      .update(changes)
      .eq('message_id', message.id)
      .select()
      .single();
  }

  if (result?.error) {
    console.error('Receipt update failed:', result.error);
    return;
  }

  if (result?.data) {
    messageReceiptCache.set(message.id, result.data);
  }
}

async function markVisibleIncomingMessagesSeen() {
  if (!currentUser || !conversationId) return;

  const incomingRows = document.querySelectorAll(
    '#messagesList .message-row.theirs[data-message-id]'
  );

  for (const row of incomingRows) {
    const messageId = row.dataset.messageId;

    if (!messageId) continue;

    await markIncomingMessageReceipt({
      id: messageId,
      sender_id: otherProfile?.id
    }, true);
  }
}

function attachReceiptVisibilityHandler() {
  if (receiptVisibilityHandlerAttached) return;

  receiptVisibilityHandlerAttached = true;

  const handleVisible = () => {
    if (
      document.visibilityState === 'visible' &&
      document.querySelector('#messagesList')
    ) {
      markVisibleIncomingMessagesSeen();
    }
  };

  document.addEventListener('visibilitychange', handleVisible);
  window.addEventListener('focus', handleVisible);
}


let activeMediaViewerUrl = null;

function closeMediaViewer() {
  const viewer = document.querySelector('#mediaViewer');
  if (viewer) viewer.remove();

  document.body.style.overflow = '';
  activeMediaViewerUrl = null;
}

function openMediaViewer(url, type, alt = '') {
  closeMediaViewer();

  activeMediaViewerUrl = url;

  const viewer = document.createElement('div');
  viewer.id = 'mediaViewer';
  viewer.className = 'media-viewer';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'media-viewer-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close media viewer');
  close.onclick = closeMediaViewer;

  const content = type === 'image'
    ? document.createElement('img')
    : document.createElement('video');

  content.className = 'media-viewer-content';
  content.src = url;
  content.alt = type === 'image' ? alt : '';
  content.controls = type === 'video';
  content.playsInline = true;

  if (type === 'image') {
    content.classList.add('media-viewer-image');
    content.addEventListener('dblclick', () => {
      content.classList.toggle('media-viewer-zoomed');
    });
  } else {
    content.autoplay = true;
  }

  viewer.append(close, content);

  viewer.addEventListener('click', event => {
    if (event.target === viewer) closeMediaViewer();
  });

  document.addEventListener('keydown', handleMediaViewerEscape);

  document.body.appendChild(viewer);
  document.body.style.overflow = 'hidden';
}

function handleMediaViewerEscape(event) {
  if (event.key === 'Escape' && document.querySelector('#mediaViewer')) {
    closeMediaViewer();
  }
}


let pinnedMessageCache = [];

async function loadPinnedMessages() {
  if (!conversationId) return;

  const { data, error } = await supabase
    .from('pinned_messages')
    .select(`
      id,
      message_id,
      pinned_by,
      created_at,
      messages (
        id,
        body,
        message_type,
        media_name,
        sender_id,
        created_at
      )
    `)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Unable to load pinned messages:', error);
    return;
  }

  pinnedMessageCache = data || [];
  renderPinnedMessages();
}

function renderPinnedMessages() {
  const banner = document.querySelector('#pinnedMessagesBanner');
  if (!banner) return;

  banner.innerHTML = '';

  if (!pinnedMessageCache.length) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;

  const heading = document.createElement('div');
  heading.className = 'pinned-banner-heading';
  heading.textContent = '📌 Pinned messages';
  banner.appendChild(heading);

  const latest = pinnedMessageCache[0];
  const message = latest.messages;

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'pinned-banner-preview';

  if (!message) {
    preview.textContent = 'Pinned message unavailable';
    preview.disabled = true;
  } else {
    preview.textContent =
      message.body ||
      message.media_name ||
      (message.message_type === 'image' ? '📷 Photo' :
       message.message_type === 'video' ? '🎥 Video' :
       message.message_type === 'audio' ? '🎤 Audio' :
       'Pinned message');

    preview.onclick = async () => {
      if (hiddenMessageIds.has(message.id)) {
        showStatus('This pinned message is hidden for you.');
        return;
      }

      let row = document.querySelector(
        '[data-message-id="' + message.id + '"]'
      );

      if (!row) {
        showStatus('Loading pinned message...');

        const { data: fetchedMessage, error } = await supabase
          .from('messages')
          .select('*')
          .eq('id', message.id)
          .eq('conversation_id', conversationId)
          .maybeSingle();

        if (error || !fetchedMessage) {
          console.error('Pinned message fetch failed:', error);
          showStatus('Could not load this pinned message.');
          return;
        }

        await appendMessage(fetchedMessage);

        row = document.querySelector(
          '[data-message-id="' + message.id + '"]'
        );
      }

      if (!row) {
        showStatus('Could not display this pinned message.');
        return;
      }

      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('message-highlight');
      setTimeout(() => row.classList.remove('message-highlight'), 1200);
    };
  }

  banner.appendChild(preview);

  if (pinnedMessageCache.length > 1) {
    const count = document.createElement('span');
    count.className = 'pinned-banner-count';
    count.textContent = '+' + (pinnedMessageCache.length - 1) + ' more';
    banner.appendChild(count);
  }
}

async function togglePinnedMessage(message) {
  if (!currentUser || !conversationId || !message?.id) return;

  const existing = pinnedMessageCache.find(
    pin => pin.message_id === message.id
  );

  if (existing) {
    const { error } = await supabase
      .from('pinned_messages')
      .delete()
      .eq('id', existing.id);

    if (error) {
      console.error('Unable to unpin message:', error);
      showStatus('Could not unpin this message.');
      return;
    }

    showStatus('Message unpinned.', 'success');
  } else {
    const { error } = await supabase
      .from('pinned_messages')
      .insert({
        conversation_id: conversationId,
        message_id: message.id,
        pinned_by: currentUser.id
      });

    if (error) {
      console.error('Unable to pin message:', error);
      showStatus(
        error.code === '23505'
          ? 'This message is already pinned.'
          : 'Could not pin this message.'
      );
      return;
    }

    showStatus('Message pinned! 📌', 'success');
  }

  await loadPinnedMessages();
}


function showStatus(text, type = 'error', duration = 0) {
  if (type === 'success') return;
  const element = document.querySelector('#statusMessage');
  if (!element) return;

  if (showStatus.timer) {
    clearTimeout(showStatus.timer);
    showStatus.timer = null;
  }

  element.textContent = text;
  element.className = `status-message ${type}`;

  if (text && duration > 0) {
    showStatus.timer = setTimeout(() => {
      element.textContent = '';
      element.className = 'status-message';
      showStatus.timer = null;
    }, duration);
  }
}

function renderAuth(info = '') {
  currentScreen = currentScreen === 'register' ? 'register' : 'login';

  app.innerHTML = `
    <main class="page">
      <div class="decor decor-one">✿</div>
      <div class="decor decor-two">♡</div>
      <div class="decor decor-three">✧</div>

      <section class="auth-card">
        <div class="brand">
          <div class="flower">🌷</div>
          <h1>Daisyshire</h1>
          <p>A little place for just us.</p>
        </div>

        <div class="welcome">
          <h2>${currentScreen === 'login'
            ? 'Welcome back' : 'Create your account'}</h2>
          <p>Your little corner is waiting for you.</p>
        </div>

        <div id="statusMessage" class="status-message"></div>

        <form id="authForm">
          ${currentScreen === 'register' ? `
            <label>Your name</label>
            <input id="displayName" maxlength="40"
              placeholder="Your name" required>
          ` : ''}

          ${currentScreen === 'register' ? `
            <label>Email address</label>
            <input id="email" type="email"
              autocomplete="email" placeholder="you@example.com" required>
          ` : `
            <label>Username or email</label>
            <input id="loginIdentifier" type="text"
              autocomplete="username" placeholder="Your username or email" required>
          `}

          <label>Password</label>
          <div class="password-wrap">
            <input id="password" type="password"
              minlength="8" required placeholder="Your password">
            <button type="button" id="togglePassword"
              class="show-password">Show</button>
          </div>

          <button class="primary-btn" id="submitButton" type="submit">
            ${currentScreen === 'login' ? 'Log in' : 'Create account'} →
          </button>
        </form>

        <div class="switch">
          ${currentScreen === 'login'
            ? 'New here? <button id="switchScreen">Create an account</button>'
            : 'Already registered? <button id="switchScreen">Log in</button>'}
        </div>

        <div class="divider">✿</div>
        <p class="privacy">A private little space, made with care.</p>
      </section>


    </main>
  `;

  if (info) showStatus(info, 'success');

  document.querySelector('#switchScreen').onclick = () => {
    currentScreen = currentScreen === 'login' ? 'register' : 'login';
    renderAuth();
  };

  document.querySelector('#togglePassword').onclick = () => {
    const input = document.querySelector('#password');
    input.type = input.type === 'password' ? 'text' : 'password';
    document.querySelector('#togglePassword').textContent =
      input.type === 'password' ? 'Show' : 'Hide';
  };

  document.querySelector('#authForm').onsubmit = handleAuth;
}

async function handleAuth(event) {
  event.preventDefault();
  if (busy) return;

  busy = true;
  const button = document.querySelector('#submitButton');
  button.disabled = true;
  button.textContent = 'Please wait...';

  const email = document.querySelector('#email')?.value.trim() || '';
  const password = document.querySelector('#password').value;

  try {
    if (currentScreen === 'register') {
      const displayName =
        document.querySelector('#displayName').value.trim();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin
        }
      });

      if (error) throw error;

      if (data.session) {
        await renderChatsPage(data.user);
      } else {
        currentScreen = 'login';
        renderAuth('Account created! Verify your email, then log in.');
      }
    } else {
      const identifier =
        document.querySelector('#loginIdentifier').value.trim();

      if (identifier.includes('@')) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: identifier,
          password
        });

        if (error) throw error;
        await renderChatsPage(data.user);
      } else {
        const { data, error } = await supabase.functions.invoke(
          'username-login',
          {
            body: {
              username: identifier,
              password
            }
          }
        );

        if (error) throw error;

        if (!data?.session?.access_token || !data?.session?.refresh_token) {
          throw new Error(data?.error || 'Username login failed.');
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
          });

        if (sessionError) throw sessionError;
        await renderChatsPage(sessionData.user);
      }
    }
  } catch (error) {
    showStatus(error.message);
    const submit = document.querySelector('#submitButton');
    if (submit) {
      submit.disabled = false;
      submit.textContent =
        currentScreen === 'login' ? 'Log in →' : 'Create account →';
    }
  } finally {
    busy = false;
  }
}

function messagePreviewText(message) {
  if (!message) return 'Message unavailable';
  if (message.message_type === 'image') return '📷 Photo';
  if (message.message_type === 'video') return '🎥 Video';
  if (message.message_type === 'audio') return '🎙 Voice message';
  return message.body || 'Message';
}

function messageSenderName(message) {
  if (message?.sender_id === currentUser?.id) {
    return ownProfile?.display_name || 'You';
  }

  return otherProfile?.display_name || 'Other participant';
}

function setReplyTarget(message) {
  replyingToMessage = message;

  const preview = document.querySelector('#replyPreview');
  const sender = document.querySelector('#replyPreviewSender');
  const text = document.querySelector('#replyPreviewText');

  if (!preview || !text) return;

  if (sender) {
    sender.textContent = 'Replying to ' + messageSenderName(message);
  }

  text.textContent = messagePreviewText(message);
  preview.hidden = false;
  preview.classList.remove('daisy-reply-preview-pop');
  void preview.offsetWidth;
  preview.classList.add('daisy-reply-preview-pop');
  document.querySelector('#messageInput')?.focus();
}

function clearReplyTarget() {
  replyingToMessage = null;

  const preview = document.querySelector('#replyPreview');
  const sender = document.querySelector('#replyPreviewSender');
  const text = document.querySelector('#replyPreviewText');

  if (preview) preview.hidden = true;
  if (sender) sender.textContent = 'Replying to';
  if (text) text.textContent = '';
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}



const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];

async function renderMessageReactions(messageId) {
  const row = document.querySelector('[data-message-id="' + messageId + '"]');
  if (!row || !currentUser) return;

  const bubble = row.querySelector('.message-bubble');
  if (!bubble) return;

  let container = bubble.querySelector('.message-reactions');

  if (!container) {
    container = document.createElement('div');
    container.className = 'message-reactions';
    bubble.appendChild(container);
  }

  const { data, error } = await supabase
    .from('message_reactions')
    .select('user_id, emoji')
    .eq('message_id', messageId);

  if (error) {
    console.error('Reaction load failed:', error);
    return;
  }

  container.innerHTML = '';

  const counts = {};
  let myReaction = null;

  for (const reaction of data || []) {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;

    if (reaction.user_id === currentUser.id) {
      myReaction = reaction.emoji;
    }
  }

  for (const emoji of REACTION_EMOJIS) {
    const count = counts[emoji] || 0;
    if (!count) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-chip';
    button.textContent = emoji + ' ' + count;

    if (myReaction === emoji) {
      button.classList.add('my-reaction');
    }

    button.onclick = async () => {
      button.disabled = true;

      let result;

      if (myReaction === emoji) {
        result = await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', currentUser.id);
      } else {
        result = await supabase
          .from('message_reactions')
          .upsert(
            {
              message_id: messageId,
              user_id: currentUser.id,
              emoji
            },
            { onConflict: 'message_id,user_id' }
          );
      }

      if (result.error) {
        showStatus('Reaction failed: ' + result.error.message);
      }

      await renderMessageReactions(messageId);
    };

    container.appendChild(button);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'reaction-add-button';
  addButton.textContent = '+';
  addButton.setAttribute('aria-label', 'Add reaction');

  addButton.onclick = () => {
    const existing = container.querySelector('.reaction-picker');

    if (existing) {
      existing.remove();
      return;
    }

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';

    for (const emoji of REACTION_EMOJIS) {
      const option = document.createElement('button');
      option.type = 'button';
      option.textContent = emoji;

      option.onclick = async () => {
        option.disabled = true;

        const { error } = await supabase
          .from('message_reactions')
          .upsert(
            {
              message_id: messageId,
              user_id: currentUser.id,
              emoji
            },
            { onConflict: 'message_id,user_id' }
          );

        if (error) {
          showStatus('Reaction failed: ' + error.message);
        }

        await renderMessageReactions(messageId);
      };

      picker.appendChild(option);
    }

    container.appendChild(picker);
  };

  container.appendChild(addButton);
}

async function hideMessageForMe(message, row) {
  const { error } = await supabase
    .from('message_user_deletions')
    .insert({
      message_id: message.id,
      user_id: currentUser.id
    });

  if (error) {
    showStatus('Could not delete message: ' + error.message);
    return;
  }

  hiddenMessageIds.add(message.id);
  row.remove();
  showStatus('Message deleted for you.');
}

async function unsendMessage(message, row) {
  if (message.sender_id !== currentUser.id) {
    showStatus('You can only unsend your own messages.');
    return;
  }

  if (!confirm('Unsend this message for everyone?')) return;

  // Keep the path before deleting the database message.
  const mediaPath = message.media_path;

  const { data, error } = await supabase
    .from('messages')
    .delete()
    .eq('id', message.id)
    .eq('sender_id', currentUser.id)
    .select('id')
    .maybeSingle();

  if (error) {
    showStatus('Could not unsend message: ' + error.message);
    return;
  }

  if (!data) {
    showStatus('Message could not be unsent.');
    return;
  }

  row.remove();

  if (mediaPath) {
    const ownFolderPrefix =
      message.conversation_id + '/' + currentUser.id + '/';

    // Only clean up files uploaded by this account.
    if (!mediaPath.startsWith(ownFolderPrefix)) {
      showStatus('Message unsent. Media cleanup skipped for safety.', 'error', 3000);
      return;
    }

    // Check whether another message still uses this file.
    const { data: references, error: checkError } = await supabase
      .from('messages')
      .select('id')
      .eq('media_path', mediaPath)
      .limit(1);

    if (checkError) {
      console.error('Media reference check failed:', checkError);
      showStatus('Message unsent. Media kept safely because cleanup could not be verified.', 'error', 3000);
      return;
    }

    if (references && references.length > 0) {
      showStatus('Message unsent. Shared media file was kept.', 'error', 3000);
      return;
    }

    const { error: storageError } = await supabase.storage
      .from('daisyshire-images')
      .remove([mediaPath]);

    if (storageError) {
      console.error('Media cleanup failed:', storageError);
      showStatus('Message unsent. Media cleanup could not be completed.', 'error', 3000);
      return;
    }
  }

  showStatus('Message unsent for everyone.', 'error', 3000);
}

async function toggleHeartReaction(messageId) {
  const { data: existing, error: lookupError } = await supabase
    .from('message_reactions')
    .select('emoji')
    .eq('message_id', messageId)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (lookupError) {
    showStatus('Could not check reaction: ' + lookupError.message);
    return;
  }

  let result;

  if (existing?.emoji === '❤️') {
    result = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', currentUser.id);
  } else {
    result = await supabase
      .from('message_reactions')
      .upsert({
        message_id: messageId,
        user_id: currentUser.id,
        emoji: '❤️'
      }, { onConflict: 'message_id,user_id' });
  }

  if (result.error) {
    showStatus('Heart reaction failed: ' + result.error.message);
    return;
  }

  await renderMessageReactions(messageId);
}

async function editTextMessage(message) {
  const nextBody = window.prompt('Edit your message:', message.body || '');

  if (nextBody === null) return;

  const body = nextBody.trim();

  if (!body) {
    showStatus('Message cannot be empty.');
    return;
  }

  if (body.length > 4000) {
    showStatus('Message must be 4000 characters or less.');
    return;
  }

  if (body === message.body) return;

  try {
    const { data, error } = await supabase
      .from('messages')
      .update({ body })
      .eq('id', message.id)
      .select('id, body, edited_at')
      .single();

    if (error) throw error;

    message.body = data.body;
    message.edited_at = data.edited_at;

    updateRenderedMessage(data);
    showStatus('Message edited successfully.', 'success');
  } catch (error) {
    showStatus('Message could not be edited: ' + error.message);
  }
}

function updateRenderedMessage(message) {
  const row = document.querySelector(
    '[data-message-id="' + message.id + '"]'
  );

  if (!row) return;

  const content = row.querySelector('.message-content');

  if (content) {
    content.textContent = message.body || '';
  }

  const time = row.querySelector('.message-time');

  if (!time) return;

  let label = time.querySelector('.message-edited-label');

  if (message.edited_at) {
    if (!label) {
      label = document.createElement('span');
      label.className = 'message-edited-label';
      label.textContent = 'Edited';
      time.appendChild(label);
    }
  } else if (label) {
    label.remove();
  }
}

async function jumpToMessage(messageId) {
  const list = document.querySelector('#messagesList');
  if (!list || !messageId) return;

  if (hiddenMessageIds.has(messageId)) {
    showStatus('This message is hidden for you.');
    return;
  }

  let row = list.querySelector(
    '[data-message-id="' + messageId + '"]'
  );

  if (!row) {
    showStatus('Loading original message...');

    const { data: fetchedMessage, error } = await supabase
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (error || !fetchedMessage) {
      console.error('Reply message fetch failed:', error);
      showStatus('Could not load the original message.');
      return;
    }

    await appendMessage(fetchedMessage);

    row = list.querySelector(
      '[data-message-id="' + messageId + '"]'
    );

    if (row) {
      const rows = [...list.querySelectorAll('.message-row')];
      const nextRow = rows.find(existing =>
        existing !== row &&
        existing.dataset.createdAt &&
        new Date(existing.dataset.createdAt) >
          new Date(fetchedMessage.created_at)
      );

      if (nextRow) list.insertBefore(row, nextRow);
    }
  }

  if (!row) {
    showStatus('Could not display the original message.');
    return;
  }

  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('message-highlight');

  setTimeout(() => {
    row.classList.remove('message-highlight');
  }, 1200);
}

async function appendMessage(message, options = {}) {
  const list = document.querySelector('#messagesList');
  if (!list || !currentUser) return;

  const wasAtBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 120;

  if (hiddenMessageIds.has(message.id)) return;

  if (list.querySelector(`[data-message-id="${message.id}"]`)) {
    return;
  }

  const mine = message.sender_id === currentUser.id;
  const item = document.createElement('div');

  item.className = `message-row ${mine ? 'mine' : 'theirs'}`;
  if (!options.prepend) item.classList.add('daisy-message-enter');
  item.dataset.messageId = message.id;
  item.dataset.createdAt = message.created_at || '';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Add the row immediately to prevent duplicate realtime messages.
  item.appendChild(bubble);
  if (options.prepend) {
    const loader = list.querySelector('.daisy-older-loader');
    list.insertBefore(
      item,
      loader ? loader.nextSibling : list.firstChild
    );
  } else {
    list.appendChild(item);
  }

  let lastTouchTap = 0;
  let lastTouchDoubleTap = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let touchStartedOnInteractive = false;

  const isInteractiveTarget = target =>
    target.closest('button, a, input, video, audio');

  const playHeartBurst = () => {
    const heart = document.createElement('span');
    heart.className = 'daisy-heart-burst';
    heart.textContent = '❤️';
    heart.setAttribute('aria-hidden', 'true');
    bubble.appendChild(heart);
    setTimeout(() => heart.remove(), 900);
  };

  bubble.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;

    touchStartX = event.clientX;
    touchStartY = event.clientY;
    touchStartTime = Date.now();
    touchStartedOnInteractive = isInteractiveTarget(event.target);
  });

  bubble.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch' || !touchStartTime || touchStartedOnInteractive) return;

    const deltaX = event.clientX - touchStartX;
    const deltaY = event.clientY - touchStartY;

    if (deltaX > 8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
      const progress = Math.min(deltaX / 85, 1);
      item.classList.add('daisy-swipe-active');
      item.style.setProperty('--daisy-swipe-progress', progress.toFixed(2));
    }
  });

  bubble.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch') return;

    if (touchStartedOnInteractive || isInteractiveTarget(event.target)) {
      lastTouchTap = 0;
      return;
    }

    const deltaX = event.clientX - touchStartX;
    const deltaY = event.clientY - touchStartY;
    const duration = Date.now() - touchStartTime;

    touchStartTime = 0;
    item.classList.remove('daisy-swipe-active');
    item.style.removeProperty('--daisy-swipe-progress');

    if (
      deltaX >= 52 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.15 &&
      duration < 850
    ) {
      lastTouchTap = 0;
      lastTouchDoubleTap = 0;
      item.classList.remove('daisy-reply-triggered');
      void item.offsetWidth;
      item.classList.add('daisy-reply-triggered');
      setTimeout(() => item.classList.remove('daisy-reply-triggered'), 350);
      setReplyTarget(message);
      return;
    }

    if (Math.abs(deltaX) > 25 || Math.abs(deltaY) > 30) {
      lastTouchTap = 0;
      return;
    }

    const now = Date.now();

    if (now - lastTouchTap < 350) {
      lastTouchTap = 0;
      lastTouchDoubleTap = now;
      playHeartBurst();
      toggleHeartReaction(message.id);
    } else {
      lastTouchTap = now;
    }
  });

  bubble.addEventListener('pointercancel', () => {
    touchStartTime = 0;
    lastTouchTap = 0;
    item.classList.remove('daisy-swipe-active');
    item.style.removeProperty('--daisy-swipe-progress');
  });

  bubble.addEventListener('dblclick', event => {
    if (isInteractiveTarget(event.target)) return;
    if (Date.now() - lastTouchDoubleTap < 500) return;

    playHeartBurst();
    toggleHeartReaction(message.id);
  });

  if (message.reply_to) {
    const { data: original } = await supabase
      .from('messages')
      .select('id, body, message_type, media_name, sender_id')
      .eq('id', message.reply_to)
      .maybeSingle();

    const quote = document.createElement('button');
    quote.type = 'button';
    quote.className = 'reply-quote';
    quote.textContent = original
      ? '↩ ' + messageSenderName(original) + ': ' + messagePreviewText(original)
      : '↩ Message unavailable';

    quote.onclick = () => {
      jumpToMessage(message.reply_to);
    };

    bubble.appendChild(quote);
  }

  if (message.message_type === 'image' ||
      message.message_type === 'video' ||
      message.message_type === 'audio') {
    const { data, error } = await supabase.storage
      .from('daisyshire-images')
      .createSignedUrl(message.media_path, SIGNED_URL_SECONDS);

    if (error || !data?.signedUrl) {
      const unavailable = document.createElement('p');
      unavailable.textContent = 'Media is temporarily unavailable.';
      bubble.appendChild(unavailable);
    } else if (message.message_type === 'image') {
      const image = document.createElement('img');
      image.src = data.signedUrl;
      image.alt = message.media_name || 'Shared image';
      image.className = 'chat-image';
      image.loading = 'lazy';
      image.style.cursor = 'zoom-in';
      image.onclick = () => openMediaViewer(
        data.signedUrl,
        'image',
        image.alt
      );
      image.onerror = () => {
        image.replaceWith(document.createTextNode('Image could not load.'));
      };
      bubble.appendChild(image);

      bubble.appendChild(
        createMediaDownloadButton(
          data.signedUrl,
          'image',
          message.media_name
        )
      );
    } else if (message.message_type === 'video') {
      const video = document.createElement('video');
      video.src = data.signedUrl;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.className = 'chat-video';
      bubble.appendChild(video);

      const openVideoButton = document.createElement('button');
      openVideoButton.type = 'button';
      openVideoButton.className = 'media-open-button';
      openVideoButton.textContent = '⛶ Open full screen';
      openVideoButton.onclick = () => openMediaViewer(
        data.signedUrl,
        'video'
      );
      bubble.appendChild(openVideoButton);

      bubble.appendChild(
        createMediaDownloadButton(
          data.signedUrl,
          'video',
          message.media_name
        )
      );
    } else {
      const audio = document.createElement('audio');
      audio.src = data.signedUrl;
      audio.controls = true;
      audio.preload = 'metadata';
      audio.className = 'chat-audio';
      bubble.appendChild(audio);
    }

    if (message.media_name) {
      const name = document.createElement('div');
      name.className = 'media-name';
      name.textContent = message.media_name;
      bubble.appendChild(name);
    }
  } else {
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.body || '';
    bubble.appendChild(content);
  }

  await renderMessageReactions(message.id);

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatTime(message.created_at);

  if (message.edited_at) {
    const editedLabel = document.createElement('span');
    editedLabel.className = 'message-edited-label';
    editedLabel.textContent = 'Edited';
    time.appendChild(editedLabel);
  }

  bubble.appendChild(time);

  if (mine) {
    const receipt = document.createElement('div');
    receipt.className = 'message-receipt';
    bubble.appendChild(receipt);

    updateMessageReceiptUI(
      message.id,
      messageReceiptCache.get(message.id)
    );
  }

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'message-menu-button';
  menuButton.textContent = '⋯';
  menuButton.setAttribute('aria-label', 'Message options');

  const menu = document.createElement('div');
  menu.className = 'message-options-menu';
  menu.hidden = true;

  // Floating message menu with outside-tap dismissal
  if (document.documentElement.dataset.dsMenuDismissBound !== '1') {
    document.addEventListener('pointerdown', event => {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('.message-actions, .message-options-menu')
      ) return;

      document
        .querySelectorAll('.message-options-menu:not([hidden])')
        .forEach(openMenu => {
          openMenu.hidden = true;

          if (openMenu._daisyActions) {
            openMenu._daisyActions.appendChild(openMenu);
          }
        });
    }, true);

    document.documentElement.dataset.dsMenuDismissBound = '1';
  }

  menu._daisyActions = actions;

  menu.addEventListener('click', () => {
    queueMicrotask(() => {
      if (menu.hidden && menu._daisyActions) {
        menu._daisyActions.appendChild(menu);
      }
    });
  });

  menuButton.onclick = () => {
    const wasOpen = !menu.hidden;

    document
      .querySelectorAll('.message-options-menu:not([hidden])')
      .forEach(openMenu => {
        openMenu.hidden = true;

        if (openMenu._daisyActions) {
          openMenu._daisyActions.appendChild(openMenu);
        }
      });

    if (wasOpen) return;

    document.body.appendChild(menu);
    menu.style.position = 'fixed';
    menu.hidden = false;

    requestAnimationFrame(() => {
      if (menu.hidden) return;

      const buttonRect = menuButton.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 10;

      let left = buttonRect.right - menuRect.width;

      left = Math.max(
        margin,
        Math.min(left, window.innerWidth - menuRect.width - margin)
      );

      let top = buttonRect.top - menuRect.height - 8;

      if (top < margin) {
        top = buttonRect.bottom + 8;
      }

      if (top + menuRect.height > window.innerHeight - margin) {
        top = Math.max(
          margin,
          window.innerHeight - menuRect.height - margin
        );
      }

      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
    });
  };

  const replyOption = document.createElement('button');
  replyOption.type = 'button';
  replyOption.textContent = '↩ Reply';
  replyOption.onclick = () => {
    menu.hidden = true;
    setReplyTarget(message);
  };
  menu.appendChild(replyOption);

  const reactOption = document.createElement('button');
  reactOption.type = 'button';
  reactOption.textContent = '＋ React';
  reactOption.onclick = () => {
    menu.hidden = true;
    const addReactionButton = bubble.querySelector('.reaction-add-button');
    if (addReactionButton) addReactionButton.click();
  };
  menu.appendChild(reactOption);

  const pinOption = document.createElement('button');
  pinOption.type = 'button';

  const alreadyPinned = pinnedMessageCache.some(
    pin => pin.message_id === message.id
  );

  pinOption.textContent = alreadyPinned
    ? '📌 Unpin message'
    : '📌 Pin message';

  pinOption.onclick = async () => {
    menu.hidden = true;
    await togglePinnedMessage(message);
  };

  menu.appendChild(pinOption);

  if (mine) {
    if (message.message_type === 'text') {
      const editOption = document.createElement('button');
      editOption.type = 'button';
      editOption.textContent = '✏️ Edit';
      editOption.onclick = async () => {
        menu.hidden = true;
        await editTextMessage(message);
      };
      menu.appendChild(editOption);
    }

    const unsendOption = document.createElement('button');
    unsendOption.type = 'button';
    unsendOption.textContent = 'Unsend';
    unsendOption.onclick = async () => {
      menu.hidden = true;
      await unsendMessage(message, item);
    };
    menu.appendChild(unsendOption);
  }

  const deleteOption = document.createElement('button');
  deleteOption.type = 'button';
  deleteOption.textContent = 'Delete for me';
  deleteOption.onclick = async () => {
    menu.hidden = true;
    await hideMessageForMe(message, item);
  };
  menu.appendChild(deleteOption);

  actions.appendChild(menuButton);
  actions.appendChild(menu);
  bubble.appendChild(actions);

  if (
    !options.prepend &&
    options.scroll !== false &&
    wasAtBottom
  ) {
    list.scrollTop = list.scrollHeight;
  }

  if (!mine) {
    await markIncomingMessageReceipt(
      message,
      document.visibilityState === 'visible'
    );
  }
}

async function loadOlderMessages() {
  const list = document.querySelector('#messagesList');

  if (
    !list ||
    loadingOlderMessages ||
    !hasMoreMessages ||
    !oldestLoadedMessage
  ) return;

  loadingOlderMessages = true;

  const previousHeight = list.scrollHeight;
  const previousTop = list.scrollTop;

  const loader = document.createElement('div');
  loader.className = 'daisy-older-loader';
  loader.innerHTML = `
    <span class="daisy-loader-spinner"></span>
    <span>Loading older messages</span>
  `;
  list.prepend(loader);

  try {
    const cursor = oldestLoadedMessage;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(MESSAGE_PAGE_SIZE);

    if (error) throw error;

    if (!data || !data.length) {
      hasMoreMessages = false;
      return;
    }

    oldestLoadedMessage = data[data.length - 1];
    hasMoreMessages = data.length === MESSAGE_PAGE_SIZE;

    const visible = data.filter(
      message => !hiddenMessageIds.has(message.id)
    );

    const ownIds = visible
      .filter(message => message.sender_id === currentUser.id)
      .map(message => message.id);

    if (ownIds.length) {
      const { data: receipts, error: receiptError } = await supabase
        .from('message_receipts')
        .select('*')
        .in('message_id', ownIds);

      if (receiptError) throw receiptError;

      for (const receipt of receipts || []) {
        messageReceiptCache.set(receipt.message_id, receipt);
      }
    }

    // Render all 40 messages concurrently.
    // Each message keeps its own replies, media, reactions and receipts.
    await Promise.all(
      visible.map(message =>
        appendMessage(message, { prepend: true })
      )
    );

    // Remove loader before measuring the final message height.
    loader.remove();

    // Preserve the reader's exact viewport after insertion.
    list.scrollTop =
      previousTop + (list.scrollHeight - previousHeight);

  } catch (error) {
    console.error('Could not load older messages:', error);
    showStatus('Could not load older messages. Please try again.');
  } finally {
    loader.remove();
    loadingOlderMessages = false;
  }
}

async function loadMessages() {
  const list = document.querySelector('#messagesList');
  if (!list) return;

  list.innerHTML = '<p class="chat-loading">Loading messages... 🌷</p>';

  oldestLoadedMessage = null;
  hasMoreMessages = true;
  loadingOlderMessages = false;

  const { data: hiddenRows, error: hiddenError } = await supabase
    .from('message_user_deletions')
    .select('message_id')
    .eq('user_id', currentUser.id);

  if (hiddenError) throw hiddenError;

  hiddenMessageIds = new Set(
    (hiddenRows || []).map(row => row.message_id)
  );

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);

  if (error) throw error;

  oldestLoadedMessage = data?.length
    ? data[data.length - 1]
    : null;

  hasMoreMessages = (data || []).length === MESSAGE_PAGE_SIZE;

  const visibleMessages = (data || [])
    .filter(message => !hiddenMessageIds.has(message.id))
    .reverse();

  messageReceiptCache.clear();

  const ownMessageIds = visibleMessages
    .filter(message => message.sender_id === currentUser.id)
    .map(message => message.id);

  if (ownMessageIds.length) {
    const { data: receipts, error: receiptError } = await supabase
      .from('message_receipts')
      .select('*')
      .in('message_id', ownMessageIds);

    if (receiptError) throw receiptError;

    for (const receipt of receipts || []) {
      messageReceiptCache.set(receipt.message_id, receipt);
    }
  }

  list.innerHTML = '';

  if (!visibleMessages.length) {
    list.innerHTML = `
      <div class="empty-chat">
        <span>🌸</span>
        <h3>Your conversation starts here</h3>
        <p>Send your first message!</p>
      </div>
    `;
    return;
  }

  // Render all initial messages immediately in chronological order.
  await Promise.all(
    visibleMessages.map(message =>
      appendMessage(message, { scroll: false })
    )
  );

  // Jump to the newest message once rendering is complete.
  list.scrollTop = list.scrollHeight;

  // Load another batch when the reader approaches the top.
  list.addEventListener('scroll', () => {
    if (list.scrollTop <= 100) {
      loadOlderMessages();
    }
  }, { passive: true });
}

async function sendMessage(event) {
  event.preventDefault();

  const input = document.querySelector('#messageInput');
  const button = document.querySelector('#sendButton');
  if (!input || button.disabled) return;

  const body = input.value.trim();
  if (!body) return;

  if (body.length > 4000) {
    showStatus('Message must be 4000 characters or less.');
    return;
  }

  button.disabled = true;

  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        body,
        message_type: 'text',
        reply_to: replyingToMessage?.id || null
      })
      .select()
      .single();

    if (error) throw error;

    await appendMessage(data);
    input.value = '';
    stopDaisyshireTyping();
    clearReplyTarget();
    // Successful message sends do not need a notification.
  } catch (error) {
    showStatus('Message could not be sent: ' + error.message);
  } finally {
    button.disabled = false;
    input.focus();
  }
}

function cleanFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
}

async function sendMedia(file) {
  if (!file || !conversationId || !currentUser) return;

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/aac',
    'audio/mpeg',
    'audio/wav'
  ];

  if (!allowedTypes.includes(file.type)) {
    showStatus('Unsupported media file.');
    return;
  }

  if (file.size > MAX_MEDIA_SIZE) {
    showStatus('File is too large. Maximum size is 50 MB.');
    return;
  }

  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');
  const messageType = isAudio ? 'audio' : (isImage ? 'image' : 'video');
  const attachmentButton = document.querySelector('#attachButton');
  const sendButton = document.querySelector('#sendButton');
  const fileInput = document.querySelector('#mediaInput');

  attachmentButton.disabled = true;
  sendButton.disabled = true;
  showStatus('Uploading your ' + messageType + '... Please wait.', 'success');

  try {
    const uniqueId = crypto.randomUUID();
    const filename = cleanFileName(file.name || 'media');
    const path =
      `${conversationId}/${currentUser.id}/${uniqueId}-${filename}`;

    const { error: uploadError } = await supabase.storage
      .from('daisyshire-images')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });

    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        body: '',
        message_type: messageType,
        media_path: path,
        media_mime: file.type,
        media_name: filename,
        reply_to: replyingToMessage?.id || null
      })
      .select()
      .single();

    if (error) {
      // Clean up an uploaded file if the message record fails.
      await supabase.storage.from('daisyshire-images').remove([path]);
      throw error;
    }

    await appendMessage(data);
    clearReplyTarget();
    // Successful media sends do not need a notification.
    return true;
  } catch (error) {
    showStatus('Upload failed: ' + error.message);
    return false;
  } finally {
    attachmentButton.disabled = false;
    sendButton.disabled = false;
    if (fileInput) fileInput.value = '';
  }
}


let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];
let recordedVoiceFile = null;
let recordedVoiceUrl = null;
let recordingInterval = null;
let recordingStartedAt = 0;

function formatRecordingTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return String(minutes).padStart(2, '0') + ':' +
    String(remaining).padStart(2, '0');
}

async function startVoiceRecording() {
  const voiceButton = document.querySelector('#voiceButton');
  const attachButton = document.querySelector('#attachButton');
  const panel = document.querySelector('#voicePanel');

  if (!voiceButton || !panel || voiceButton.disabled) return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showStatus('Voice recording is not supported. Try HTTPS or localhost.');
    return;
  }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    const formats = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg'
    ];

    const chosenFormat = formats.find(type =>
      MediaRecorder.isTypeSupported(type)
    );

    mediaRecorder = chosenFormat
      ? new MediaRecorder(recordingStream, { mimeType: chosenFormat })
      : new MediaRecorder(recordingStream);

    recordedChunks = [];
    recordedVoiceFile = null;

    mediaRecorder.ondataavailable = event => {
      if (event.data?.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      if (recordingInterval) clearInterval(recordingInterval);
      recordingInterval = null;

      recordingStream?.getTracks().forEach(track => track.stop());
      recordingStream = null;

      const mime = (mediaRecorder.mimeType || 'audio/webm').split(';')[0];
      const extension = mime === 'audio/mp4' ? 'm4a' :
        mime === 'audio/ogg' ? 'ogg' :
        mime === 'audio/mpeg' ? 'mp3' : 'webm';

      const blob = new Blob(recordedChunks, { type: mime });

      if (!blob.size) {
        showStatus('No audio was recorded. Please try again.');
        discardVoiceRecording();
        return;
      }

      recordedVoiceFile = new File(
        [blob],
        'voice-' + Date.now() + '.' + extension,
        { type: mime }
      );

      if (recordedVoiceUrl) URL.revokeObjectURL(recordedVoiceUrl);
      recordedVoiceUrl = URL.createObjectURL(blob);

      panel.innerHTML =
        '<div class="voice-preview">' +
        '<p>🎧 Preview your voice message</p>' +
        '<audio controls preload="metadata" src="' + recordedVoiceUrl + '"></audio>' +
        '<div class="voice-actions">' +
        '<button type="button" id="discardVoiceButton">Discard</button>' +
        '<button type="button" id="sendVoiceButton">Send voice message ➤</button>' +
        '</div></div>';

      document.querySelector('#discardVoiceButton').onclick =
        discardVoiceRecording;
      document.querySelector('#sendVoiceButton').onclick =
        sendVoiceRecording;

      showStatus('Voice message ready to preview!', 'success');
    };

    panel.hidden = false;
    panel.innerHTML =
      '<div class="recording-indicator">' +
      '<span class="recording-dot"></span>' +
      '<span>Recording: <strong id="recordingClock">00:00</strong></span>' +
      '<button type="button" id="stopRecordingButton">Stop recording</button>' +
      '</div>';

    voiceButton.disabled = true;
    if (attachButton) attachButton.disabled = true;

    document.querySelector('#stopRecordingButton').onclick =
      stopVoiceRecording;

    recordingStartedAt = Date.now();
    mediaRecorder.start();

    recordingInterval = setInterval(() => {
      const clock = document.querySelector('#recordingClock');
      if (clock) {
        clock.textContent = formatRecordingTime(
          Math.floor((Date.now() - recordingStartedAt) / 1000)
        );
      }
    }, 500);

    showStatus('Recording voice message...', 'success');
  } catch (error) {
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingStream = null;
    voiceButton.disabled = false;
    if (attachButton) attachButton.disabled = false;
    showStatus('Could not start recording: ' + error.message);
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function discardVoiceRecording() {
  if (recordedVoiceUrl) URL.revokeObjectURL(recordedVoiceUrl);

  recordedVoiceUrl = null;
  recordedVoiceFile = null;
  recordedChunks = [];

  const panel = document.querySelector('#voicePanel');
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = '';
  }

  const voiceButton = document.querySelector('#voiceButton');
  const attachButton = document.querySelector('#attachButton');

  if (voiceButton) voiceButton.disabled = false;
  if (attachButton) attachButton.disabled = false;
}

async function sendVoiceRecording() {
  if (!recordedVoiceFile) return;

  const sendButton = document.querySelector('#sendVoiceButton');
  if (sendButton) sendButton.disabled = true;

  const sent = await sendMedia(recordedVoiceFile);

  if (sent) {
    discardVoiceRecording();
  } else if (sendButton) {
    sendButton.disabled = false;
  }
}


let cameraStream = null;
let cameraRecorder = null;
let cameraChunks = [];
let cameraMode = 'photo';
let cameraPreviewUrl = null;
let cameraFacingMode = 'environment';
let cameraFilter = 'none';
let cameraRecordingTimerInterval = null;
let cameraRecordingStartedAt = 0;

function updateDaisyCameraTimer() {
  const timer = document.querySelector('#cameraRecordingTimer');
  if (!timer || !cameraRecordingStartedAt) return;

  const seconds = Math.floor((Date.now() - cameraRecordingStartedAt) / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  timer.textContent = minutes + ':' + remainder;
}

function startDaisyCameraTimer() {
  stopDaisyCameraTimer();

  cameraRecordingStartedAt = Date.now();
  const timer = document.querySelector('#cameraRecordingTimer');

  if (timer) {
    timer.hidden = false;
    timer.textContent = '00:00';
  }

  updateDaisyCameraTimer();
  cameraRecordingTimerInterval = setInterval(updateDaisyCameraTimer, 250);
}

function stopDaisyCameraTimer() {
  if (cameraRecordingTimerInterval) {
    clearInterval(cameraRecordingTimerInterval);
    cameraRecordingTimerInterval = null;
  }

  cameraRecordingStartedAt = 0;

  const timer = document.querySelector('#cameraRecordingTimer');
  if (timer) {
    timer.hidden = true;
    timer.textContent = '00:00';
  }
}

const DAISY_CAMERA_FILTERS = {
  natural: 'none',
  rose: 'saturate(1.18) sepia(.12) hue-rotate(320deg) brightness(1.05)',
  lavender: 'saturate(1.12) hue-rotate(15deg) brightness(1.06)',
  honey: 'sepia(.28) saturate(1.2) contrast(1.04)',
  cloud: 'brightness(1.12) saturate(.82) contrast(.94)',
  peach: 'sepia(.18) saturate(1.2) hue-rotate(338deg)'
};

function closeDaisyshireCamera() {
  stopDaisyCameraTimer();

  if (cameraRecorder && cameraRecorder.state !== 'inactive') {
    cameraRecorder.stop();
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const panel = document.querySelector('#cameraPanel');
  if (panel) {
    panel.hidden = true;
    panel.classList.remove('daisy-camera-studio');
    panel.innerHTML = '';
  }
}

async function openDaisyshireCamera() {
  const panel = document.querySelector('#cameraPanel');
  if (!panel) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showStatus('Camera requires HTTPS or localhost.');
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    cameraFilter = 'none';
    panel.classList.add('daisy-camera-studio');
    panel.hidden = false;
    panel.innerHTML = `
      <div class="camera-interface daisy-camera-interface daisy-instagram-camera">

        <div class="daisy-camera-topbar">
          <button type="button" id="closeCameraButton" aria-label="Close camera">×</button>
          <button type="button" id="flashCameraButton" aria-label="Toggle flash">ϟ</button>
          <div id="cameraRecordingTimer" class="daisy-camera-recording-timer" hidden>00:00</div>
          <button type="button" id="flipCameraButton" aria-label="Flip camera">⟳</button>
        </div>

        <div class="daisy-camera-view">
          <video id="cameraLivePreview" autoplay muted playsinline></video>
          <div class="daisy-camera-grid" id="cameraGridOverlay" hidden></div>
          <span class="daisy-camera-filter-label" id="cameraFilterLabel">Natural</span>
        </div>

        <div class="daisy-camera-side-tools">
          <button type="button" id="cameraFiltersShortcut">
            <span>✧</span> Filters
          </button>
          <button type="button" id="cameraGridButton">
            <span>▦</span> Grid
          </button>
        </div>

        <div class="daisy-instagram-bottom">

          <div class="daisy-filter-section">
            <p>✨ Choose your vibe</p>
            <div class="daisy-filter-strip">
              <button type="button" class="daisy-filter active" data-camera-filter="natural">
                <span class="daisy-filter-dot natural"></span>Natural
              </button>
              <button type="button" class="daisy-filter" data-camera-filter="rose">
                <span class="daisy-filter-dot rose"></span>Rose Glow
              </button>
              <button type="button" class="daisy-filter" data-camera-filter="lavender">
                <span class="daisy-filter-dot lavender"></span>Lavender
              </button>
              <button type="button" class="daisy-filter" data-camera-filter="honey">
                <span class="daisy-filter-dot honey"></span>Honey Film
              </button>
              <button type="button" class="daisy-filter" data-camera-filter="cloud">
                <span class="daisy-filter-dot cloud"></span>Cloud Soft
              </button>
              <button type="button" class="daisy-filter" data-camera-filter="peach">
                <span class="daisy-filter-dot peach"></span>Peach Bloom
              </button>
            </div>
          </div>

          <div class="daisy-camera-mode">
            <span class="daisy-mode-slider"></span>
            <button type="button" id="photoModeButton" class="active">PHOTO</button>
            <button type="button" id="videoModeButton">VIDEO</button>
          </div>

          <div class="daisy-instagram-capture-row">
            <button type="button" id="cameraGalleryButton" aria-label="Choose from gallery">▧</button>
            <button type="button" id="captureCameraButton" aria-label="Capture"></button>
            <span class="daisy-camera-bottom-spacer"></span>
          </div>

        </div>
      </div>
    `;

    const live = document.querySelector('#cameraLivePreview');
    live.srcObject = cameraStream;
    live.style.setProperty(
      'transform',
      cameraFacingMode === 'user' ? 'scaleX(-1)' : 'none',
      'important'
    );
    await live.play();

    const filterButtons = panel.querySelectorAll('[data-camera-filter]');
    filterButtons.forEach(button => {
      button.onclick = () => {
        cameraFilter = button.dataset.cameraFilter;
        live.style.filter = DAISY_CAMERA_FILTERS[cameraFilter] || 'none';

        filterButtons.forEach(item =>
          item.classList.toggle('active', item === button)
        );

        const label = document.querySelector('#cameraFilterLabel');
        if (label) label.textContent = button.textContent.trim();
      };
    });

    const photoButton = document.querySelector('#photoModeButton');
    const videoButton = document.querySelector('#videoModeButton');

    photoButton.onclick = () => {
      if (cameraRecorder?.state === 'recording') return;

      cameraMode = 'photo';
      photoButton.classList.add('active');
      videoButton.classList.remove('active');
      document.querySelector('.daisy-camera-mode')
        ?.classList.remove('video-selected');

      const capture = document.querySelector('#captureCameraButton');
      if (capture) {
        capture.classList.remove('recording');
        capture.setAttribute('aria-label', 'Take photo');
      }
    };

    videoButton.onclick = () => {
      if (cameraRecorder?.state === 'recording') return;

      cameraMode = 'video';
      videoButton.classList.add('active');
      photoButton.classList.remove('active');
      document.querySelector('.daisy-camera-mode')
        ?.classList.add('video-selected');

      const capture = document.querySelector('#captureCameraButton');
      if (capture) capture.setAttribute('aria-label', 'Start video recording');
    };

    document.querySelector('#flipCameraButton').onclick =
      switchDaisyshireCamera;

    document.querySelector('#closeCameraButton').onclick =
      closeDaisyshireCamera;

    document.querySelector('#captureCameraButton').onclick =
      captureDaisyshireMedia;

    let flashEnabled = false;
    document.querySelector('#flashCameraButton').onclick = async event => {
      const track = cameraStream?.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.();

      if (!capabilities?.torch) {
        showStatus('Flash is not supported by this camera.');
        return;
      }

      try {
        flashEnabled = !flashEnabled;
        await track.applyConstraints({
          advanced: [{ torch: flashEnabled }]
        });
        event.currentTarget.classList.toggle('active', flashEnabled);
      } catch (error) {
        flashEnabled = false;
        showStatus('Could not change flash setting.');
      }
    };

    document.querySelector('#cameraGridButton').onclick = () => {
      const grid = document.querySelector('#cameraGridOverlay');
      if (grid) {
        grid.hidden = !grid.hidden;
        document.querySelector('#cameraGridButton')
          .classList.toggle('active', !grid.hidden);
      }
    };

    document.querySelector('#cameraFiltersShortcut').onclick = () => {
      document.querySelector('.daisy-filter-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    document.querySelector('#cameraGalleryButton').onclick = () => {
      closeDaisyshireCamera();
      document.querySelector('#mediaInput')?.click();
    };


  } catch (error) {
    closeDaisyshireCamera();
    showStatus('Could not open camera: ' + error.message);
  }
}

async function switchDaisyshireCamera() {
  if (!cameraStream) return;

  if (cameraRecorder && cameraRecorder.state === 'recording') {
    showStatus('Stop video recording before switching cameras.');
    return;
  }

  const nextFacing = cameraFacingMode === 'environment'
    ? 'user'
    : 'environment';

  const button = document.querySelector('#flipCameraButton');
  if (button) button.disabled = true;

  const oldStream = cameraStream;

  try {
    oldStream.getTracks().forEach(track => track.stop());

    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: nextFacing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    cameraStream = nextStream;
    cameraFacingMode = nextFacing;

    const live = document.querySelector('#cameraLivePreview');
    if (live) {
      live.srcObject = cameraStream;
      live.style.setProperty(
        'transform',
        cameraFacingMode === 'user' ? 'scaleX(-1)' : 'none',
        'important'
      );
      await live.play();
    }

    showStatus(
      cameraFacingMode === 'user'
        ? 'Front camera selected.'
        : 'Back camera selected.',
      'success'
    );
  } catch (error) {
    cameraStream = null;
    showStatus('Could not switch camera: ' + error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function captureDaisyshireMedia() {
  const live = document.querySelector('#cameraLivePreview');
  if (!live || !cameraStream) return;

  if (cameraMode === 'photo') {
    const canvas = document.createElement('canvas');
    canvas.width = live.videoWidth;
    canvas.height = live.videoHeight;

    if (!canvas.width || !canvas.height) {
      showStatus('Camera is still starting. Try again.');
      return;
    }

    const context = canvas.getContext('2d');
    context.filter = DAISY_CAMERA_FILTERS[cameraFilter] || 'none';
    context.drawImage(live, 0, 0);
    context.filter = 'none';

    canvas.toBlob(blob => {
      if (!blob) {
        showStatus('Could not capture photo.');
        return;
      }

      const photo = new File(
        [blob],
        'camera-' + Date.now() + '.jpg',
        { type: 'image/jpeg' }
      );

      closeDaisyshireCamera();
      showCameraMediaPreview(photo);
    }, 'image/jpeg', 0.9);

    return;
  }

  const formats = [
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];

  const mimeType = formats.find(type =>
    MediaRecorder.isTypeSupported(type)
  );

  if (!mimeType) {
    showStatus('Video recording is not supported by this browser.');
    return;
  }

  cameraChunks = [];
  cameraRecorder = new MediaRecorder(cameraStream, { mimeType });

  cameraRecorder.ondataavailable = event => {
    if (event.data?.size) cameraChunks.push(event.data);
  };

  cameraRecorder.onstop = () => {
    stopDaisyCameraTimer();

    const mime = cameraRecorder.mimeType.split(';')[0];
    const extension = mime === 'video/mp4' ? 'mp4' : 'webm';
    const blob = new Blob(cameraChunks, { type: mime });

    const video = new File(
      [blob],
      'camera-' + Date.now() + '.' + extension,
      { type: mime }
    );

    closeDaisyshireCamera();

    if (video.size) showCameraMediaPreview(video);
    else showStatus('No video was captured.');
  };

  cameraRecorder.start();

  const captureButton = document.querySelector('#captureCameraButton');
  if (captureButton) {
    captureButton.classList.add('recording');
    captureButton.setAttribute('aria-label', 'Stop video recording');
  }

  startDaisyCameraTimer();

  captureButton.onclick = () => {
    if (cameraRecorder?.state === 'recording') {
      cameraRecorder.stop();
    }
  };

  showStatus('Video recording started.', 'success');
}

function showCameraMediaPreview(file) {
  const panel = document.querySelector('#cameraPanel');
  if (!panel) return;

  if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl);
  cameraPreviewUrl = URL.createObjectURL(file);

  const isVideo = file.type.startsWith('video/');
  const media = isVideo
    ? '<video controls playsinline src="' + cameraPreviewUrl + '"></video>'
    : '<img src="' + cameraPreviewUrl + '" alt="Captured photo preview">';

  panel.hidden = false;
  panel.innerHTML = `
    <div class="camera-preview">
      <p>Preview your capture</p>
      ${media}
      <div class="camera-controls">
        <button type="button" id="discardCameraMedia">Discard</button>
        <button type="button" id="sendCameraMedia">Send</button>
      </div>
    </div>
  `;

  document.querySelector('#discardCameraMedia').onclick = () => {
    URL.revokeObjectURL(cameraPreviewUrl);
    cameraPreviewUrl = null;
    panel.hidden = true;
    panel.innerHTML = '';
  };

  document.querySelector('#sendCameraMedia').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;

    const sent = await sendMedia(file);

    if (sent) {
      URL.revokeObjectURL(cameraPreviewUrl);
      cameraPreviewUrl = null;
      panel.hidden = true;
      panel.innerHTML = '';
    } else {
      button.disabled = false;
    }
  };
}

function updateOnlineStatus() {
  const status = document.querySelector('#connectionStatus');
  if (!status) return;

  const avatar = document.querySelector('#chatPersonAvatar');
  const otherUsers = [...onlineUserIds].filter(id => id !== currentUser?.id);
  if (avatar) avatar.classList.toggle('is-online', otherUsers.length > 0);

  if (otherUsers.length > 0) {
    status.textContent = 'Online now · Private conversation ♡';
    status.classList.add('presence-online');
  } else {
    status.textContent = 'Offline · Private conversation ♡';
    status.classList.remove('presence-online');
  }
}

async function startDaisyshirePresence() {
  if (!currentUser || !conversationId) return;

  if (presenceChannel) {
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  onlineUserIds = new Set();

  presenceChannel = supabase.channel(
    'daisyshire-presence-' + conversationId,
    {
      config: {
        presence: {
          key: currentUser.id
        }
      }
    }
  );

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      onlineUserIds = new Set(Object.keys(state));
      updateOnlineStatus();
    })
    .on('presence', { event: 'join' }, ({ key }) => {
      onlineUserIds.add(key);
      updateOnlineStatus();
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      onlineUserIds.delete(key);
      updateOnlineStatus();
    });

  presenceChannel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      const { error } = await presenceChannel.track({
        user_id: currentUser.id,
        online_at: new Date().toISOString()
      });

      if (error) {
        console.error('Presence tracking failed:', error);
      }
    }
  });
}


function showRemoteTyping(isTyping) {
  const indicator = document.querySelector('#typingIndicator');
  const label = document.querySelector('#typingIndicatorText');

  if (!indicator || !label) return;

  if (isTyping) {
    label.textContent =
      (otherProfile?.display_name || 'Someone') + ' is typing...';
    indicator.hidden = false;

    clearTimeout(remoteTypingTimer);
    remoteTypingTimer = setTimeout(() => {
      indicator.hidden = true;
    }, 3500);
  } else {
    clearTimeout(remoteTypingTimer);
    indicator.hidden = true;
  }
}

async function broadcastDaisyshireTyping(isTyping) {
  if (!typingChannel || !typingChannelReady || !currentUser) return;

  try {
    await typingChannel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        user_id: currentUser.id,
        typing: isTyping
      }
    });
  } catch (error) {
    console.warn('Typing broadcast failed:', error);
  }
}

function stopDaisyshireTyping() {
  clearTimeout(typingStopTimer);
  typingStopTimer = null;
  lastTypingBroadcast = 0;
  broadcastDaisyshireTyping(false);
}

function handleDaisyshireTyping() {
  const input = document.querySelector('#messageInput');
  if (!input) return;

  if (!input.value.trim()) {
    stopDaisyshireTyping();
    return;
  }

  const now = Date.now();

  if (now - lastTypingBroadcast > 900) {
    lastTypingBroadcast = now;
    broadcastDaisyshireTyping(true);
  }

  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => {
    stopDaisyshireTyping();
  }, 1400);
}

async function startDaisyshireTyping() {
  if (!conversationId || !currentUser) return;

  if (typingChannel) {
    await supabase.removeChannel(typingChannel);
    typingChannel = null;
  }

  typingChannelReady = false;

  typingChannel = supabase
    .channel('daisyshire-typing-' + conversationId)
    .on(
      'broadcast',
      { event: 'typing' },
      ({ payload }) => {
        if (!payload || payload.user_id === currentUser.id) return;

        showRemoteTyping(payload.typing === true);
      }
    )
    .subscribe(status => {
      typingChannelReady = status === 'SUBSCRIBED';
    });
}

async function stopDaisyshireTypingChannel() {
  clearTimeout(typingStopTimer);
  clearTimeout(remoteTypingTimer);

  typingStopTimer = null;
  remoteTypingTimer = null;
  typingChannelReady = false;

  const indicator = document.querySelector('#typingIndicator');
  if (indicator) indicator.hidden = true;

  if (typingChannel) {
    await supabase.removeChannel(typingChannel);
    typingChannel = null;
  }
}

async function searchDaisyshireUsers() {
  const input = document.querySelector('#daisyUserSearchInput');
  const results = document.querySelector('#daisyUserSearchResults');
  const button = document.querySelector('#daisyUserSearchButton');

  if (!input || !results || !button) return;

  const query = input.value.trim();

  results.replaceChildren();

  if (query.length < 2) {
    results.textContent = 'Enter at least 2 characters to search. 🌷';
    return;
  }

  button.disabled = true;
  button.textContent = 'Searching...';

  const loading = document.createElement('p');
  loading.textContent = 'Finding Daisyshire users...';
  results.appendChild(loading);

  try {
    const { data, error } = await supabase.rpc(
      'search_daisyshire_users',
      { p_query: query }
    );

    if (error) throw error;

    results.replaceChildren();

    if (!data?.length) {
      results.textContent = 'No users found. Try another username. ♡';
      return;
    }

    for (const user of data) {
      const card = document.createElement('div');
      card.className = 'daisy-user-result';

      const details = document.createElement('div');
      details.className = 'daisy-user-result-details';

      const name = document.createElement('strong');
      name.textContent = user.display_name || 'Daisyshire User';

      const username = document.createElement('span');
      username.textContent = '@' + user.username;

      details.append(name, username);

      const messageButton = document.createElement('button');
      messageButton.type = 'button';
      messageButton.className = 'daisy-message-user-button';
      messageButton.textContent = 'Message';

      messageButton.addEventListener('click', async () => {
        messageButton.disabled = true;
        messageButton.textContent = 'Opening...';

        try {
          const { data: newConversationId, error } = await supabase.rpc(
            'start_daisyshire_conversation',
            { p_other_user_id: user.user_id }
          );

          if (error) throw error;
          if (!newConversationId) {
            throw new Error('No conversation ID was returned.');
          }

          await renderChat(currentUser, newConversationId);
        } catch (error) {
          console.error('Could not open conversation:', error);
          messageButton.disabled = false;
          messageButton.textContent = 'Message';
          alert('Could not open this chat. Please try again.');
        }
      });

      card.append(details, messageButton);
      results.appendChild(card);
    }
  } catch (error) {
    console.error('Daisyshire user search failed:', error);
    results.replaceChildren();
    results.textContent = 'Search failed. Please try again.';
  } finally {
    button.disabled = false;
    button.textContent = 'Search';
  }
}


async function loadDaisyshireProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, username, bio, avatar_path')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getDaisyshireAvatar(path) {
  if (!path) return '';

  const { data, error } = await supabase.storage
    .from('daisyshire-avatars')
    .createSignedUrl(path, SIGNED_URL_SECONDS);

  if (error) {
    console.error('Avatar URL error:', error);
    return '';
  }

  return data.signedUrl;
}

async function loadDaisyshireProfiles() {
  ownProfile = await loadDaisyshireProfile(currentUser.id);

  if (!ownProfile) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: currentUser.id,
        display_name:
          currentUser.user_metadata?.display_name || 'Daisyshire User'
      })
      .select()
      .single();

    if (error) throw error;
    ownProfile = data;
  }

  const { data: members, error } = await supabase
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  if (error) throw error;

  const otherMember = members.find(
    member => member.user_id !== currentUser.id
  );

  otherProfile = otherMember
    ? await loadDaisyshireProfile(otherMember.user_id)
    : null;

  updateDaisyshireChatHeader();
}

async function updateDaisyshireChatHeader() {
  const name = document.querySelector('#chatPersonName');
  const avatar = document.querySelector('#chatPersonAvatar');
  const status = document.querySelector('#connectionStatus');

  if (!name || !avatar) return;

  name.textContent =
    otherProfile?.display_name || 'Our conversation';

  const username = document.querySelector('#chatPersonUsername');
  if (username) {
    username.textContent = otherProfile?.username
      ? '@' + otherProfile.username
      : '';
  }

  const avatarUrl = await getDaisyshireAvatar(
    otherProfile?.avatar_path
  );

  if (avatarUrl) {
    avatar.innerHTML =
      '<img src="' + safe(avatarUrl) + '" alt="Profile picture">';
  } else {
    avatar.textContent = '♡';
  }

  if (status) updateOnlineStatus();
}

async function openOtherDaisyshireProfile() {
  const modal = document.querySelector('#otherProfileModal');
  if (!modal || !otherProfile) return;

  const name = document.querySelector('#otherProfileName');
  const username = document.querySelector('#otherProfileUsername');
  const bio = document.querySelector('#otherProfileBio');
  const avatar = document.querySelector('#otherProfileAvatar');

  name.textContent = otherProfile.display_name || 'Daisyshire User';
  username.textContent = otherProfile.username
    ? '@' + otherProfile.username
    : '';
  bio.textContent = otherProfile.bio || 'No bio yet.';

  avatar.textContent = '♡';
  avatar.innerHTML = '';

  const url = await getDaisyshireAvatar(otherProfile.avatar_path);

  if (url && modal.hidden === false) {
    avatar.innerHTML =
      '<img src="' + safe(url) + '" alt="Profile picture">';
  } else if (modal.hidden === false) {
    avatar.textContent = '♡';
  }

  modal.hidden = false;
}

function closeOtherDaisyshireProfile() {
  const modal = document.querySelector('#otherProfileModal');
  if (modal) modal.hidden = true;
}

async function startDaisyshireProfileRealtime() {
  if (!conversationId || !otherProfile?.id) return;

  if (profileChannel) {
    await supabase.removeChannel(profileChannel);
    profileChannel = null;
  }

  profileChannel = supabase
    .channel('daisyshire-profile-' + conversationId)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: 'id=eq.' + otherProfile.id
      },
      async () => {
        try {
          otherProfile = await loadDaisyshireProfile(otherProfile.id);
          await updateDaisyshireChatHeader();

          const modal = document.querySelector('#otherProfileModal');
          if (modal && !modal.hidden) {
            await openOtherDaisyshireProfile();
          }
        } catch (error) {
          console.error('Profile refresh failed:', error);
        }
      }
    )
    .subscribe();
}

function openDaisyshireProfile() {
  const modal = document.querySelector('#profileModal');
  if (!modal || !ownProfile) return;

  const name = document.querySelector('#profileDisplayName');
  const username = document.querySelector('#profileUsername');
  const bio = document.querySelector('#profileBio');
  const preview = document.querySelector('#profileAvatarPreview');

  name.value = ownProfile.display_name || '';
  username.value = ownProfile.username || '';
  bio.value = ownProfile.bio || '';

  preview.textContent = '♡';
  preview.innerHTML = '';

  getDaisyshireAvatar(ownProfile.avatar_path).then(url => {
    if (url && modal.hidden === false) {
      preview.innerHTML =
        '<img src="' + safe(url) + '" alt="Your profile picture">';
    } else if (!url) {
      preview.textContent = '♡';
    }
  });

  modal.hidden = false;
}


async function uploadDaisyshireAvatar(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showStatus('Choose a JPG, PNG or WebP image.');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showStatus('Profile pictures must be under 5 MB.');
    return;
  }

  const button = document.querySelector('#chooseAvatarButton');
  button.disabled = true;
  button.textContent = 'Uploading...';

  try {
    const extension = file.type === 'image/png' ? 'png'
      : file.type === 'image/webp' ? 'webp' : 'jpg';

    const path = currentUser.id + '/' +
      crypto.randomUUID() + '.' + extension;

    const { error: uploadError } = await supabase.storage
      .from('daisyshire-avatars')
      .upload(path, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) throw uploadError;

    const oldPath = ownProfile?.avatar_path;

    const { data, error } = await supabase
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', currentUser.id)
      .select()
      .single();

    if (error) {
      await supabase.storage.from('daisyshire-avatars').remove([path]);
      throw error;
    }

    ownProfile = data;

    const previewUrl = await getDaisyshireAvatar(path);
    const preview = document.querySelector('#profileAvatarPreview');

    if (previewUrl) {
      preview.innerHTML = '<img src="' + safe(previewUrl) +
        '" alt="Your profile picture">';
    }

    await updateDaisyshireChatHeader();

    if (oldPath && oldPath !== path) {
      const { error: deleteError } = await supabase.storage
        .from('daisyshire-avatars')
        .remove([oldPath]);

      if (deleteError) {
        console.warn('Old avatar cleanup failed:', deleteError);
      }
    }

    showStatus('Profile picture updated! ♡', 'success');
  } catch (error) {
    showStatus('Avatar upload failed: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Change photo';
  }
}

async function saveDaisyshireProfile(event) {
  event.preventDefault();

  const button = document.querySelector('#saveProfileButton');
  const displayName =
    document.querySelector('#profileDisplayName').value.trim();
  const username =
    document.querySelector('#profileUsername').value.trim().toLowerCase();
  const bio = document.querySelector('#profileBio').value.trim();

  if (!displayName) {
    showStatus('Please enter your display name.');
    return;
  }

  if (username && !/^[a-z0-9_]{3,20}$/.test(username)) {
    showStatus('Username must be 3–20 characters: letters, numbers or underscores.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        display_name: displayName,
        username: username || null,
        bio
      })
      .eq('id', currentUser.id)
      .select()
      .single();

    if (error) throw error;

    ownProfile = data;

    const { error: metadataError } = await supabase.auth.updateUser({
      data: { display_name: displayName }
    });

    if (metadataError) {
      console.warn('Auth display name sync:', metadataError.message);
    }

    document.querySelector('#profileModal').hidden = true;
    showStatus('Your profile has been updated! ♡', 'success');
  } catch (error) {
    showStatus(
      error.code === '23505'
        ? 'That username is already taken.'
        : error.message
    );
  } finally {
    button.disabled = false;
    button.textContent = 'Save changes';
  }
}

async function renderChatsPage(user = currentUser) {
  if (!user) return;

  currentUser = user;
  currentScreen = 'chats';

  if (videoCallController) {
    await videoCallController.destroy();
    videoCallController = null;
  }

  await stopDaisyshireTypingChannel();

  if (profileChannel) {
    await supabase.removeChannel(profileChannel);
    profileChannel = null;
  }

  if (presenceChannel) {
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  if (chatChannel) {
    await supabase.removeChannel(chatChannel);
    chatChannel = null;
  }

  conversationId = null;
  otherProfile = null;

  app.innerHTML = `
    <main class="chat-page">
      <section class="chat-card daisy-chats-screen">
        <header class="daisy-chats-page-header">
          <div>
            <h1>Chats ♡</h1>
            <p>Your little conversations in Daisyshire</p>
          </div>
          <button type="button" id="chatsLogoutButton"
            class="logout-btn">Log out</button>
        </header>

        <div class="daisy-user-search">
          <input id="daisyUserSearchInput"
            type="search"
            maxlength="20"
            placeholder="Search people by username...">
          <button type="button" id="daisyUserSearchButton">
            Search
          </button>
        </div>

        <div id="daisyUserSearchResults"
          class="daisy-user-search-results"></div>

        <h3 class="daisy-conversations-title">
          Your conversations
        </h3>

        <div id="daisyConversationList"
          class="daisy-conversation-list">
          <p>Loading your conversations... 🌷</p>
        </div>
      </section>
    </main>
  `;

  document.querySelector('#chatsLogoutButton').onclick =
    async () => {
      const { error } = await supabase.auth.signOut();
      if (error) alert(error.message);
    };

  const searchInput =
    document.querySelector('#daisyUserSearchInput');

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.querySelector('#daisyUserSearchButton').click();
    }
  });

  document.querySelector('#daisyUserSearchButton').onclick =
    searchDaisyshireUsers;

  const list = document.querySelector('#daisyConversationList');

  try {
    const { data: ownMemberships, error: ownError } =
      await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

    if (ownError) throw ownError;

    const conversationIds = [
      ...new Set((ownMemberships || [])
        .map(row => row.conversation_id))
    ];

    if (!conversationIds.length) {
      list.textContent =
        'No conversations yet. Search for someone to say hello! 🌷';
      return;
    }

    const { data: members, error: membersError } =
      await supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', conversationIds);

    if (membersError) throw membersError;

    const otherUsers = (members || []).filter(
      member => member.user_id !== user.id
    );

    const otherUserIds = [
      ...new Set(otherUsers.map(member => member.user_id))
    ];

    if (!otherUserIds.length) {
      list.textContent =
        'No other conversations yet. Search for someone! 🌷';
      return;
    }

    const { data: profiles, error: profilesError } =
      await supabase
        .from('profiles')
        .select('id, display_name, username, avatar_path')
        .in('id', otherUserIds);

    if (profilesError) throw profilesError;

    const profileMap = new Map(
      (profiles || []).map(profile => [profile.id, profile])
    );

    const { data: messages, error: messagesError } =
      await supabase
        .from('messages')
        .select('conversation_id, sender_id, body, message_type, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .limit(500);

    if (messagesError) throw messagesError;

    const latestMessages = new Map();

    for (const message of messages || []) {
      if (!latestMessages.has(message.conversation_id)) {
        latestMessages.set(message.conversation_id, message);
      }
    }

    const items = otherUsers
      .filter(member => profileMap.has(member.user_id))
      .map(member => ({
        conversationId: member.conversation_id,
        profile: profileMap.get(member.user_id),
        latest: latestMessages.get(member.conversation_id)
      }));

    items.sort((a, b) =>
      new Date(b.latest?.created_at || 0) -
      new Date(a.latest?.created_at || 0)
    );

    list.replaceChildren();

    if (!items.length) {
      list.textContent =
        'No conversations yet. Search for someone! 🌷';
      return;
    }

    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'daisy-conversation-item';

      const avatar = document.createElement('div');
      avatar.className = 'daisy-conversation-avatar';
      avatar.textContent = '♡';

      if (item.profile.avatar_path) {
        const url = await getDaisyshireAvatar(
          item.profile.avatar_path
        );

        if (url) {
          const image = document.createElement('img');
          image.src = url;
          image.alt = '';
          avatar.replaceChildren(image);
        }
      }

      const details = document.createElement('div');
      details.className = 'daisy-conversation-details';

      const name = document.createElement('strong');
      name.textContent =
        item.profile.display_name || 'Daisyshire User';

      const preview = document.createElement('span');
      preview.textContent = item.latest
        ? messagePreviewText(item.latest)
        : 'Start your conversation ♡';

      details.append(name, preview);

      const time = document.createElement('span');
      time.className = 'daisy-conversation-time';
      time.textContent = item.latest
        ? formatTime(item.latest.created_at)
        : '';

      button.append(avatar, details, time);

      button.onclick = () =>
        renderChat(user, item.conversationId);

      list.appendChild(button);
    }
  } catch (error) {
    console.error('Chats page loading failed:', error);
    list.textContent =
      'Could not load conversations. Please try again.';
  }
}


async function renderChat(user, selectedConversationId = null) {
  if (videoCallController) {
    await videoCallController.destroy();
    videoCallController = null;
  }

  await stopDaisyshireTypingChannel();
  currentUser = user;

  if (profileChannel) {
    await supabase.removeChannel(profileChannel);
    profileChannel = null;
  }

  if (chatChannel) {
    await supabase.removeChannel(chatChannel);
    chatChannel = null;
  }

  if (presenceChannel) {
    await supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  conversationId = null;
  replyingToMessage = null;
  hiddenMessageIds = new Set();
  messageReceiptCache = new Map();
  oldestLoadedMessage = null;
  hasMoreMessages = true;
  loadingOlderMessages = false;

  app.innerHTML = `
    <main class="chat-page">
      <section class="chat-card">
        <div class="chat-title">
          <button type="button" id="openOtherProfileButton"
            class="other-profile-trigger" aria-label="View profile">
            <div class="chat-avatar" id="chatPersonAvatar">♡</div>
            <div class="other-profile-heading">
              <h2 id="chatPersonName">Our conversation</h2>
              <span id="chatPersonUsername" class="chat-person-username"></span>
              <p id="connectionStatus">Connecting...</p>
            </div>
          </button>
          <div class="chat-header-actions">
            <button type="button" id="openChatsButton"
              class="profile-open-button">
              Chats
            </button>
            <button type="button" id="startVideoCallButton"
              class="daisy-video-call-button"
              aria-label="Start video call" title="Start video call">📹</button>
            <button id="openProfileButton" class="profile-open-button">
              My Profile
            </button>
            <button id="logoutButton" class="logout-btn">Log out</button>
          </div>
        </div>

        <section id="daisyChatsPanel" class="daisy-chats-panel" hidden>
          <div class="daisy-chats-heading">
            <h3>Your conversations ♡</h3>
            <button type="button" id="closeChatsButton"
              aria-label="Close chats">×</button>
          </div>

          <div class="daisy-user-search">
            <input id="daisyUserSearchInput"
              type="search"
              maxlength="20"
              placeholder="Search by username...">
            <button type="button" id="daisyUserSearchButton">
              Search
            </button>
          </div>

          <div id="daisyUserSearchResults"
            class="daisy-user-search-results"></div>

          <div id="daisyConversationList"
            class="daisy-conversation-list">
            <p>Loading your conversations... 🌷</p>
          </div>
        </section>

        <div id="typingIndicator" class="typing-indicator" hidden>
          <span class="typing-dots"><i></i><i></i><i></i></span>
          <span id="typingIndicatorText">Typing...</span>
        </div>

        <div id="statusMessage" class="status-message"></div>

        <div id="pinnedMessagesBanner"
          class="pinned-messages-banner" hidden></div>

        <div id="messagesList" class="messages-list">
          <p class="chat-loading">Opening Daisyshire... 🌷</p>
        </div>

        <div id="replyPreview" class="reply-preview" hidden>
          <div class="reply-preview-content">
            <strong id="replyPreviewSender">Replying to</strong>
            <span id="replyPreviewText"></span>
          </div>
          <button type="button" id="cancelReplyButton"
            aria-label="Cancel reply">×</button>
        </div>

        <form id="messageForm" class="message-form">
          <input
            type="file"
            id="mediaInput"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            hidden
          >

          <button
            type="button"
            id="attachButton"
            class="attach-button"
            aria-label="Attach image or video"
            title="Attach image or video"
          >＋</button>

          <button
            type="button"
            id="cameraButton"
            class="camera-button"
            aria-label="Open camera"
            title="Take a photo or video"
          >📷</button>

          <textarea
            id="messageInput"
            rows="1"
            maxlength="4000"
            placeholder="Write something sweet..."
          ></textarea>

          <button
            type="button"
            id="voiceButton"
            class="voice-button"
            aria-label="Record voice message"
            title="Record voice message"
          >🎙</button>

          <button id="sendButton" type="submit" aria-label="Send message">
            <span>➤</span>
          </button>
        </form>

        <div id="cameraPanel" class="camera-panel" hidden></div>
        <div id="voicePanel" class="voice-panel" hidden></div>

        <p class="chat-footer">
          Photos and videos · A little place for just us ♡
        </p>
      </section>

      <section id="otherProfileModal"
        class="profile-modal" hidden>
        <div class="other-profile-card">
          <button type="button" id="closeOtherProfileButton"
            class="profile-close-button">×</button>
          <div id="otherProfileAvatar" class="other-profile-avatar">♡</div>
          <h2 id="otherProfileName">Daisyshire User</h2>
          <p id="otherProfileUsername" class="other-profile-username"></p>
          <p id="otherProfileBio" class="other-profile-bio"></p>
          <span class="other-profile-note">A little space in Daisyshire ♡</span>
        </div>
      </section>

      <section id="profileModal" class="profile-modal" hidden>
        <div class="profile-editor">
          <div class="profile-editor-heading">
            <div>
              <h2>Your profile</h2>
              <p>Your little Daisyshire identity ♡</p>
            </div>
            <button type="button" id="closeProfileButton"
              class="profile-close-button">×</button>
          </div>

          <div class="profile-avatar-area">
            <div id="profileAvatarPreview" class="profile-avatar-preview">♡</div>
            <div>
              <strong>Profile picture</strong>
              <p>JPG, PNG or WebP · Max 5 MB</p>
              <button type="button" id="chooseAvatarButton"
                class="profile-photo-button">Change photo</button>
              <input type="file" id="profileAvatarInput"
                accept="image/jpeg,image/png,image/webp" hidden>
            </div>
          </div>

          <form id="profileForm" class="profile-form">
            <label for="profileDisplayName">Display name</label>
            <input id="profileDisplayName" maxlength="40"
              placeholder="Your name" required>

            <label for="profileUsername">Username</label>
            <input id="profileUsername" maxlength="20"
              placeholder="yourusername">

            <label for="profileBio">Bio</label>
            <textarea id="profileBio" maxlength="150"
              rows="3" placeholder="A little about you..."></textarea>

            <button type="submit" id="saveProfileButton">
              Save changes
            </button>
          </form>
        </div>
      </section>
    </main>
  `;

  document.querySelector('#openChatsButton').onclick = () => {
    renderChatsPage(currentUser);
  };

  document.querySelector('#closeChatsButton').onclick = () => {
    const panel = document.querySelector('#daisyChatsPanel');
    if (panel) panel.hidden = true;
  };

  document.querySelector('#daisyUserSearchInput').addEventListener(
    'keydown',
    event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.querySelector('#daisyUserSearchButton').click();
      }
    }
  );

  document.querySelector('#daisyUserSearchButton').onclick =
    searchDaisyshireUsers;

  document.querySelector('#openProfileButton').onclick =
    openDaisyshireProfile;

  document.querySelector('#openOtherProfileButton').onclick =
    openOtherDaisyshireProfile;

  document.querySelector('#startVideoCallButton').onclick = () => {
    videoCallController?.startCall();
  };

  document.querySelector('#closeOtherProfileButton').onclick =
    closeOtherDaisyshireProfile;

  document.querySelector('#otherProfileModal').onclick = event => {
    if (event.target.id === 'otherProfileModal') {
      closeOtherDaisyshireProfile();
    }
  };

  document.querySelector('#closeProfileButton').onclick = () => {
    document.querySelector('#profileModal').hidden = true;
  };

  document.querySelector('#profileForm').onsubmit =
    saveDaisyshireProfile;

  document.querySelector('#chooseAvatarButton').onclick = () => {
    document.querySelector('#profileAvatarInput').click();
  };

  document.querySelector('#profileAvatarInput').onchange = event => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) uploadDaisyshireAvatar(selectedFile);
    event.target.value = '';
  };


  document.querySelector('#logoutButton').onclick = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) alert(error.message);
  };

  document.querySelector('#messageForm').onsubmit = sendMessage;

  const typingInput = document.querySelector('#messageInput');
  typingInput.addEventListener('keydown', event => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.isComposing ||
      event.keyCode === 229
    ) return;

    event.preventDefault();
    document.querySelector('#messageForm')?.requestSubmit();
  });
  typingInput.addEventListener('input', handleDaisyshireTyping);
  typingInput.addEventListener('blur', stopDaisyshireTyping);

  document.querySelector('#cancelReplyButton').onclick = clearReplyTarget;

  const fileInput = document.querySelector('#mediaInput');

  document.querySelector('#attachButton').onclick = () => {
    fileInput.click();
  };

  document.querySelector('#voiceButton').onclick = startVoiceRecording;
  document.querySelector('#cameraButton').onclick = openDaisyshireCamera;

  fileInput.onchange = () => {
    if (fileInput.files?.[0]) {
      sendMedia(fileInput.files[0]);
    }
  };

  try {
    if (selectedConversationId) {
      const { data: membership, error: membershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('conversation_id', selectedConversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        throw new Error('You are not a member of this conversation.');
      }

      conversationId = selectedConversationId;
    } else {
      const { data: conversation, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('pair_key', 'daisyshire-main')
        .single();

      if (error) throw error;

      conversationId = conversation.id;
    }

    chatChannel = supabase
      .channel('daisyshire-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        payload => {
          appendMessage(payload.new);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        payload => {
          updateRenderedMessage(payload.new);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages'
        },
        payload => {
          if (payload.old?.id) {
            const row = document.querySelector(
              '[data-message-id="' + payload.old.id + '"]'
            );
            if (row) row.remove();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions'
        },
        payload => {
          const messageId =
            payload.new?.message_id || payload.old?.message_id;

          if (messageId) {
            renderMessageReactions(messageId);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_receipts'
        },
        payload => {
          const receipt = payload.new;

          if (receipt?.message_id) {
            messageReceiptCache.set(receipt.message_id, receipt);
            updateMessageReceiptUI(receipt.message_id, receipt);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pinned_messages'
        },
        async () => {
          await loadPinnedMessages();
        }
      )
      .subscribe(status => {
        const statusElement =
          document.querySelector('#connectionStatus');

        if (!statusElement) return;

        statusElement.textContent =
          status === 'SUBSCRIBED'
            ? 'Connected · Private conversation ♡'
            : status === 'CHANNEL_ERROR'
              ? 'Realtime connection issue'
              : 'Connecting...';
      });

    await loadDaisyshireProfiles();

    videoCallController = createDaisyshireCallController({
      supabase,
      getCurrentUser: () => currentUser,
      getConversationId: () => conversationId,
      getOtherProfile: () => otherProfile
    });

    try {
      await videoCallController.startSignaling();
      console.log('Daisyshire video calling is ready.');
    } catch (callError) {
      console.error('Video-call signalling could not start:', callError);
    }

    await startDaisyshireTyping();
    await startDaisyshireProfileRealtime();

    await startDaisyshirePresence();

    await loadMessages();
    await loadPinnedMessages();
    attachReceiptVisibilityHandler();

  } catch (error) {
    const list = document.querySelector('#messagesList');
    if (list) {
      list.innerHTML = `
        <div class="empty-chat">
          <span>🌷</span>
          <h3>Unable to open conversation</h3>
          <p>${safe(error.message)}</p>
        </div>
      `;
    }
  }
}


function showDaisyshireGame() {
  renderDaisyGame({
    root: app,
    onEnter: async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        renderAuth('Could not check your session. Please try again.');
      } else if (data.session) {
        await renderChatsPage(data.session.user);
      } else {
        currentScreen = 'login';
        renderAuth();
      }
    }
  });
}

async function startApp() {
  showDaisyshireGame();
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    if (videoCallController) {
      videoCallController.destroy().catch(console.error);
      videoCallController = null;
    }

    stopDaisyshireTypingChannel();

    // SIGNED_OUT_PROFILE_CHANNEL_CLEANUP
    if (profileChannel) {
      supabase.removeChannel(profileChannel);
      profileChannel = null;
    }

    if (presenceChannel) {
      supabase.removeChannel(presenceChannel);
      presenceChannel = null;
    }

    onlineUserIds = new Set();

    if (chatChannel) {
      supabase.removeChannel(chatChannel);
      chatChannel = null;
    }

    currentUser = null;
    conversationId = null;
    currentScreen = 'login';
    showDaisyshireGame();
  }
});

startApp();
