// Main Application Controller

// State
let state = {
  currentUser: null,
  userProfile: null,
  guilds: [],
  currentGuildId: null, // null means Home / DM
  currentChannelId: null,
  channels: [],
  members: [],
  roles: [],
  memberRoles: [],
  currentPermissions: 0n,
  
  // Subscriptions
  msgSub: null,
  membersSub: null,
  profilesSub: null,

  // Direct Messages and Friends
  dmMessages: {},
  currentDMUserId: null,
  allProfiles: [],

  // Voice State
  voice: {
    activeChannelId: null,
    activeGuildId: null,
    presenceChannel: null,  // Supabase Realtime channel for signaling + presence
    localStream: null,
    peers: {},              // { [userId]: { pc, analyser, speakingInterval } }
    audioContext: null,
    localAnalyser: null,
    localSpeakingInterval: null,
    isMuted: false,
    isDeafened: false,
    guildVoiceStates: {}   // { [userId]: { channel_id, display_name, avatar_url } } for viewed guild
  }
};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  // Bind Window Controls
  document.getElementById('btn-minimize').addEventListener('click', () => window.windowControls.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.windowControls.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.windowControls.close());

  // Check Supabase setup
  if (!window.api.isConfigured()) {
    showConfigWarning();
    return;
  }

  // Bind Auth events
  setupAuthEventListeners();
  
  // Bind Modal and Panel actions
  setupAppEventListeners();

  // Listen for custom protocol URLs (e.g., discord-clone://confirm-signup#access_token=...)
  window.windowControls.onOpenUrl(async (url) => {
    console.log('Received deep link URL:', url);
    try {
      const hashPart = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
      if (!hashPart) return;

      const params = new URLSearchParams(hashPart);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        // Authenticate the session
        state.currentUser = await window.api.setSession(accessToken, refreshToken);
        await bootstrapApp();
        alert('¡Correo verificado e inicio de sesión exitoso!');
      }
    } catch (err) {
      console.error('Deep link verification failed', err);
      alert('Error al verificar correo vía enlace: ' + err.message);
    }
  });

  // Check current session
  try {
    const { data: { user } } = await window.api.getCurrentUser();
    if (user) {
      state.currentUser = user;
      await bootstrapApp();
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.error('Session check failed', err);
    showAuthScreen();
  }
});

// Display Configuration Error if .env is missing or default
function showConfigWarning() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('auth-modal').classList.add('hidden');
  
  // Create a stunning warning panel
  const warningPanel = document.createElement('div');
  warningPanel.className = 'modal-box card-modal';
  warningPanel.innerHTML = `
    <h2 class="modal-title" style="color:var(--status-dnd);">Configuración Requerida</h2>
    <p class="modal-subtitle">Supabase no está configurado o tiene las credenciales por defecto.</p>
    <div style="background-color:var(--background-secondary); padding:16px; border-radius:6px; font-size:14px; line-height:1.5; color:var(--text-normal); margin-bottom:20px; border:1px solid var(--border-color);">
      Por favor, sigue estos pasos:
      <ol style="margin-left:20px; margin-top:8px; display:flex; flex-direction:column; gap:8px;">
        <li>Crea un proyecto en tu consola de <strong>Supabase</strong>.</li>
        <li>Copia el archivo <strong>sql_setup.sql</strong> y ejecútalo en el SQL Editor de tu proyecto.</li>
        <li>Edita el archivo <strong>.env</strong> en la raíz del proyecto agregando tu <strong>SUPABASE_URL</strong> y tu <strong>SUPABASE_KEY</strong> (Anon Key).</li>
        <li>Reinicia esta aplicación de Electron.</li>
      </ol>
    </div>
    <div style="display:flex; justify-content:center;">
      <button class="btn btn-primary" onclick="location.reload()">Reintentar Conexión</button>
    </div>
  `;
  document.getElementById('modal-overlay').appendChild(warningPanel);
}

// -------------------------------------------------------------
// Auth Logic
// -------------------------------------------------------------
function showAuthScreen() {
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('auth-modal').classList.remove('hidden');
  showLoginForm();
}

function showLoginForm() {
  document.getElementById('auth-form-login').classList.remove('hidden');
  document.getElementById('auth-form-register').classList.add('hidden');
}

function showRegisterForm() {
  document.getElementById('auth-form-login').classList.add('hidden');
  document.getElementById('auth-form-register').classList.remove('hidden');
}

function setupAuthEventListeners() {
  document.getElementById('link-show-register').addEventListener('click', (e) => {
    e.preventDefault();
    showRegisterForm();
  });

  document.getElementById('link-show-login').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginForm();
  });

  document.getElementById('link-paste-token').addEventListener('click', async (e) => {
    e.preventDefault();
    
    // Create a beautiful custom prompt modal overlay since window.prompt() is disabled in Electron
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '5000';
    overlay.innerHTML = `
      <div class="modal-box card-modal" style="width: 440px; padding: 24px; position: relative;">
        <h3 class="modal-title" style="font-size: 18px; text-align: left; margin-bottom: 8px;">Confirmación Manual</h3>
        <p class="modal-subtitle" style="text-align: left; font-size: 13px; margin-bottom: 16px;">Pega el enlace completo de verificación que se abrió en tu navegador:</p>
        <div class="auth-input-group" style="margin-bottom: 16px;">
          <input type="text" id="manual-token-url-input" placeholder="http://localhost:3000/#access_token=..." style="font-size: 13px;">
        </div>
        <div class="flex-actions-row">
          <button class="btn btn-secondary btn-sm" id="btn-manual-token-cancel" style="padding: 6px 12px; font-size: 13px; margin-right: 8px;">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="btn-manual-token-submit" style="padding: 6px 12px; font-size: 13px;">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('btn-manual-token-cancel').onclick = () => overlay.remove();
    document.getElementById('btn-manual-token-submit').onclick = async () => {
      const url = document.getElementById('manual-token-url-input').value.trim();
      overlay.remove();
      if (!url) return;
      
      try {
        const hashPart = url.includes('#') ? url.split('#')[1] : url;
        const params = new URLSearchParams(hashPart);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (!accessToken || !refreshToken) {
          alert('El enlace de verificación no contiene las credenciales requeridas.');
          return;
        }

        // Establish session in Supabase
        state.currentUser = await window.api.setSession(accessToken, refreshToken);
        await bootstrapApp();
        alert('¡Inicio de sesión exitoso!');
      } catch (err) {
        alert('Error al verificar e iniciar sesión: ' + err.message);
      }
    };
  });

  // Login click
  document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (!email || !password) return alert('Por favor, rellena todos los campos');

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Iniciando sesión...';

    try {
      state.currentUser = await window.api.signIn(email, password);
      await bootstrapApp();
    } catch (err) {
      alert('Error al iniciar sesión: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Iniciar sesión';
    }
  });

  // Register click
  document.getElementById('btn-register').addEventListener('click', async () => {
    const email = document.getElementById('register-email').value;
    const username = document.getElementById('register-username').value;
    const displayname = document.getElementById('register-displayname').value;
    const password = document.getElementById('register-password').value;

    if (!email || !username || !password) return alert('Por favor, rellena los campos requeridos');

    const btn = document.getElementById('btn-register');
    btn.disabled = true;
    btn.textContent = 'Creando cuenta...';

    try {
      state.currentUser = await window.api.signUp(email, password, username, displayname);
      alert('Registro completado. Por favor, inicia sesión con tu cuenta.');
      showLoginForm();
    } catch (err) {
      alert('Error al registrarse: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Continuar';
    }
  });
}

// -------------------------------------------------------------
// Core Bootstrap
// -------------------------------------------------------------
async function bootstrapApp() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('app-container').classList.remove('hidden');

  // Load User profile
  state.userProfile = await window.api.getUserProfile(state.currentUser.id);
  updateUserProfileUI();

  // Setup profile status updates listener
  if (state.profilesSub) state.profilesSub.unsubscribe();
  state.profilesSub = window.api.subscribeToProfiles((updatedProfile) => {
    // If it's another user, refresh members or friends list depending on view state
    if (updatedProfile.id !== state.currentUser.id) {
      if (state.currentGuildId) {
        const memIndex = state.members.findIndex(m => m.user_id === updatedProfile.id);
        if (memIndex !== -1) {
          state.members[memIndex].profiles = updatedProfile;
          renderMembersList();
        }
      } else {
        const activeTab = document.querySelector('.friends-tab.active')?.getAttribute('data-tab') || 'online';
        loadFriends(activeTab);
      }
    }
  });

  // Load Guilds (Servers)
  await loadGuilds();

  // Load home default view
  selectHome();
}

function updateUserProfileUI() {
  // Footer profile display
  document.getElementById('footer-display-name').textContent = state.userProfile.display_name || state.userProfile.username;
  document.getElementById('footer-username').textContent = `@${state.userProfile.username}`;
  
  if (state.userProfile.avatar_url) {
    document.getElementById('footer-avatar').src = state.userProfile.avatar_url;
  } else {
    document.getElementById('footer-avatar').src = 'https://cdn.discordapp.com/embed/avatars/0.png';
  }

  // Update status indicators in footer
  const statusDot = document.getElementById('footer-status-dot');
  statusDot.className = `status-indicator ${state.userProfile.status || 'offline'}`;
}

async function loadGuilds() {
  try {
    state.guilds = await window.api.getGuilds();
    renderGuilds();
  } catch (err) {
    console.error('Error fetching servers:', err.message, err.details, err.stack || err);
  }
}

// -------------------------------------------------------------
// UI Navigation Rendering
// -------------------------------------------------------------
function renderGuilds() {
  const container = document.getElementById('guild-list-container');
  container.innerHTML = '';

  state.guilds.forEach(guild => {
    const item = document.createElement('div');
    item.className = 'server-item';
    if (state.currentGuildId === guild.id) {
      item.classList.add('active');
    }
    item.setAttribute('data-tooltip', guild.name);
    item.addEventListener('click', () => selectGuild(guild.id));

    const indicator = document.createElement('div');
    indicator.className = 'pill-indicator';
    item.appendChild(indicator);

    const icon = document.createElement('div');
    icon.className = 'server-icon';
    if (guild.icon_url) {
      icon.innerHTML = `<img src="${guild.icon_url}" alt="${guild.name}">`;
    } else {
      // Initials of name
      const initials = guild.name.split(' ').map(n => n[0]).join('').substring(0, 3).toUpperCase();
      icon.textContent = initials;
    }
    item.appendChild(icon);
    container.appendChild(item);
  });
}

function selectHome() {
  state.currentGuildId = null;
  state.currentChannelId = null;
  state.currentDMUserId = null;
  state.channels = [];
  state.members = [];
  state.roles = [];
  state.memberRoles = [];
  state.currentPermissions = 0n;

  // Unsubscribe realtime
  if (state.msgSub) state.msgSub.unsubscribe();
  if (state.membersSub) state.membersSub.unsubscribe();
  state.msgSub = null;
  state.membersSub = null;

  // Update Guild list active selections
  renderGuilds();
  document.getElementById('btn-home').classList.add('active');

  // Sidebar header
  document.getElementById('sidebar-header-title').querySelector('.header-title-text').textContent = 'Inicio';
  document.getElementById('guild-settings-trigger').classList.add('hidden');

  // Load friends and populate direct messages scroller
  loadFriends('online');

  // Show Friends Panel and hide Chat Panels
  document.getElementById('friends-view').classList.remove('hidden');
  document.getElementById('friends-active-sidebar').classList.remove('hidden');
  document.getElementById('messages-scroller').classList.add('hidden');
  document.getElementById('member-sidebar').classList.add('hidden');
  document.getElementById('message-input-area').classList.add('hidden');
  document.getElementById('voice-status-bar').classList.add('hidden');

  // Reset friends tabs
  const friendsTabs = document.querySelectorAll('.friends-tab');
  friendsTabs.forEach(t => {
    if (t.getAttribute('data-tab') === 'online') {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });
  document.getElementById('friends-list').classList.remove('hidden');
  document.getElementById('add-friend-form-box').classList.add('hidden');

  // Update Chat Header for Home
  document.getElementById('chat-header-icon').innerHTML = '<path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>';
  document.getElementById('chat-title').textContent = 'Amigos';
  document.getElementById('chat-description').textContent = 'Tu panel principal de inicio.';
  document.getElementById('btn-create-invite').classList.add('hidden');
  document.getElementById('btn-toggle-members').classList.add('hidden');
}

async function selectGuild(guildId) {
  state.currentGuildId = guildId;
  state.currentDMUserId = null;
  document.getElementById('btn-home').classList.remove('active');

  // Hide Friends Panels and show Chat Panels
  document.getElementById('friends-view').classList.add('hidden');
  document.getElementById('friends-active-sidebar').classList.add('hidden');
  document.getElementById('messages-scroller').classList.remove('hidden');
  document.getElementById('member-sidebar').classList.remove('hidden');

  // Rerender server bar selection
  renderGuilds();

  // Show Header controls
  document.getElementById('btn-create-invite').classList.remove('hidden');
  document.getElementById('btn-toggle-members').classList.remove('hidden');

  // Load guild details (Channels, Members, Roles)
  const guild = state.guilds.find(g => g.id === guildId);
  if (!guild) {
    console.warn(`Guild with id ${guildId} not found in state`);
    return;
  }
  document.getElementById('sidebar-header-title').querySelector('.header-title-text').textContent = guild.name;
  
  // Permissions calculations
  state.currentPermissions = await window.api.calculatePermissions(guildId, state.currentUser.id);
  
  // Server settings trigger visibility based on permissions
  const settingsTrigger = document.getElementById('guild-settings-trigger');
  const hasManageServer = (state.currentPermissions & window.api.PERMISSIONS.MANAGE_GUILD) === window.api.PERMISSIONS.MANAGE_GUILD || 
                           (state.currentPermissions & window.api.PERMISSIONS.ADMINISTRATOR) === window.api.PERMISSIONS.ADMINISTRATOR;
  if (hasManageServer) {
    settingsTrigger.classList.remove('hidden');
  } else {
    settingsTrigger.classList.add('hidden');
  }

  // Fetch roles and linkages
  state.roles = await window.api.getGuildRoles(guildId);
  state.memberRoles = await window.api.getMemberRoles(guildId);

  // Fetch Channels
  state.channels = await window.api.getGuildChannels(guildId);

  // Subscribe to guild voice presence (see who is in which voice channel)
  subscribeToGuildVoicePresence(guildId);

  renderChannels();

  // Fetch Members list
  await loadGuildMembers();

  // Setup Realtime Guild updates (Members list, roles changed)
  if (state.membersSub) state.membersSub.unsubscribe();
  state.membersSub = window.api.subscribeToGuildMembers(guildId, async () => {
    // Refresh member details and roles
    state.roles = await window.api.getGuildRoles(guildId);
    state.memberRoles = await window.api.getMemberRoles(guildId);
    state.currentPermissions = await window.api.calculatePermissions(guildId, state.currentUser.id);
    await loadGuildMembers();
  });

  // Select general channel or first channel
  const textChannels = state.channels.filter(c => c.type === 'text');
  if (textChannels.length > 0) {
    // Try to find channel named general
    const general = textChannels.find(c => c.name === 'general') || textChannels[0];
    selectChannel(general.id);
  } else {
    // No text channels
    document.getElementById('message-feed').innerHTML = '<div style="padding:20px; text-align:center;">Este servidor no tiene canales de texto.</div>';
    document.getElementById('message-input-area').classList.add('hidden');
  }
}

// Subscribe to guild-wide voice presence so we can see who's in which voice channel
function subscribeToGuildVoicePresence(guildId) {
  const supabase = window.api.supabase;
  if (!supabase) return;

  // Remove previous guild voice presence subscription completely from client cache
  if (state.voice.guildPresenceSub) {
    supabase.removeChannel(state.voice.guildPresenceSub);
    state.voice.guildPresenceSub = null;
  }
  state.voice.guildVoiceStates = {};

  const channel = supabase.channel(`guild_voice_presence:${guildId}`);
  channel
    .on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      console.log(`[Presence Sync] guild_voice_presence:${guildId} state:`, presenceState);
      state.voice.guildVoiceStates = {};
      Object.values(presenceState).forEach(presences => {
        presences.forEach(p => {
          state.voice.guildVoiceStates[p.user_id] = p;
        });
      });
      console.log(`[Presence Mapped] guildVoiceStates:`, state.voice.guildVoiceStates);
      renderChannels();
    })
    .subscribe(async (status, err) => {
      console.log(`[Presence Subscription] guild_voice_presence:${guildId} status:`, status, err || '');
      if (status === 'SUBSCRIBED') {
        if (state.voice.activeChannelId && state.voice.activeGuildId === guildId) {
          const payload = {
            user_id: state.currentUser.id,
            channel_id: state.voice.activeChannelId,
            guild_id: state.voice.activeGuildId,
            display_name: state.userProfile.display_name || state.userProfile.username,
            username: state.userProfile.username,
            avatar_url: state.userProfile.avatar_url || null,
            isMuted: state.voice.isMuted,
            isDeafened: state.voice.isDeafened,
            speaking: false
          };
          console.log(`[Presence Track] Re-tracking current user in guild ${guildId}:`, payload);
          const res = await channel.track(payload);
          console.log(`[Presence Track Result]`, res);
        }
      }
    });

  state.voice.guildPresenceSub = channel;
}

async function loadGuildMembers() {
  try {
    state.members = await window.api.getGuildMembers(state.currentGuildId);
    renderMembersList();
  } catch (err) {
    console.error('Error loading guild members', err);
  }
}

function renderChannels() {
  const container = document.getElementById('channel-list-scroller');
  container.innerHTML = '';

  const hasManageChannels = (state.currentPermissions & window.api.PERMISSIONS.MANAGE_CHANNELS) === window.api.PERMISSIONS.MANAGE_CHANNELS || 
                            (state.currentPermissions & window.api.PERMISSIONS.ADMINISTRATOR) === window.api.PERMISSIONS.ADMINISTRATOR;

  // Text channels category
  const textHeader = document.createElement('div');
  textHeader.className = 'channel-category-label';
  textHeader.innerHTML = `
    <span>Canales de texto</span>
    ${hasManageChannels ? `
    <button class="add-channel-btn" data-type="text" data-tooltip="Crear canal">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    </button>
    ` : ''}
  `;
  container.appendChild(textHeader);

  // Bind plus button click
  const textAddBtn = textHeader.querySelector('.add-channel-btn');
  if (textAddBtn) {
    textAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCreateChannelModal('text');
    });
  }

  const textChannels = state.channels.filter(c => c.type === 'text');
  textChannels.forEach(channel => {
    const link = document.createElement('div');
    link.className = 'channel-link';
    if (state.currentChannelId === channel.id) link.classList.add('active');
    
    // Hash SVG
    link.innerHTML = `
      <svg class="hashtag-icon" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M5.886 21l.886-5.886H1.143v-1.745h5.886l.886-5.886H2.286V5.738h5.886l.886-4.738h1.745L9.917 5.738h5.886l.886-4.738h1.745l-.886 4.738h5.631v1.745h-5.886l-.886 5.886h5.631v1.745h-5.886L16.29 21h-1.745l.886-5.886H9.545L8.66 21H6.914zm3.543-7.631h5.886l.886-5.886H9.429l-.886 5.886z"/></svg>
      <span>${channel.name}</span>
    `;

    if (hasManageChannels) {
      const editBtn = document.createElement('button');
      editBtn.className = 'channel-delete-btn';
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73-1.69.98l-.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l-.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openChannelSettings(channel);
      });
      link.appendChild(editBtn);
    }

    link.addEventListener('click', () => selectChannel(channel.id));
    container.appendChild(link);
  });

  // Voice channels category
  const voiceHeader = document.createElement('div');
  voiceHeader.className = 'channel-category-label';
  voiceHeader.innerHTML = `
    <span>Canales de voz</span>
    ${hasManageChannels ? `
    <button class="add-channel-btn" data-type="voice" data-tooltip="Crear canal">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    </button>
    ` : ''}
  `;
  container.appendChild(voiceHeader);

  // Bind plus button click
  const voiceAddBtn = voiceHeader.querySelector('.add-channel-btn');
  if (voiceAddBtn) {
    voiceAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCreateChannelModal('voice');
    });
  }

  const voiceChannels = state.channels.filter(c => c.type === 'voice');
  voiceChannels.forEach(channel => {
    const isActiveVoice = state.voice.activeChannelId === channel.id;
    const link = document.createElement('div');
    link.className = 'channel-link';
    if (isActiveVoice) link.classList.add('active');
    link.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm5.9 8.1c-.5 0-.9.4-1 .8C16.5 14.2 14.5 16 12 16s-4.5-1.8-4.9-4.1c-.1-.5-.5-.8-1-.8-.6 0-1.1.5-1 1.1.5 3.2 3 5.8 6.2 6.2V20H8c-.6 0-1 .4-1 1s.4 1 1 1h8c.6 0 1-.4 1-1s-.4-1-1-1h-3.1v-1.6c3.2-.4 5.7-3 6.2-6.2.1-.6-.4-1.1-1-1.1z"/></svg>
      <span>${channel.name}</span>
    `;

    if (hasManageChannels) {
      const editBtn = document.createElement('button');
      editBtn.className = 'channel-delete-btn';
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73-1.69.98l-.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l-.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openChannelSettings(channel);
      });
      link.appendChild(editBtn);
    }

    link.addEventListener('click', () => connectVoiceChannel(channel));
    container.appendChild(link);

    // Render voice participants under the channel
    const participants = Object.values(state.voice.guildVoiceStates).filter(vs => vs.channel_id === channel.id);
    participants.forEach(vs => {
      const participantRow = document.createElement('div');
      participantRow.className = 'voice-participant-row';
      participantRow.id = `voice-user-${vs.user_id}`;
      const avatarSrc = vs.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
      participantRow.innerHTML = `
        <div class="voice-participant-avatar-wrap">
          <img class="voice-participant-avatar" src="${avatarSrc}" id="voice-avatar-${vs.user_id}">
          ${vs.isMuted ? '<svg class="voice-muted-icon" width="10" height="10" viewBox="0 0 24 24" fill="#f23f43"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>' : ''}
        </div>
        <span class="voice-participant-name">${vs.display_name || vs.username || 'Usuario'}</span>
      `;
      container.appendChild(participantRow);
    });
  });
}

async function selectChannel(channelId) {
  state.currentChannelId = channelId;
  
  // Render active selection
  renderChannels();

  const channel = state.channels.find(c => c.id === channelId);
  document.getElementById('chat-title').textContent = channel.name;
  document.getElementById('chat-description').textContent = `Canal de texto #${channel.name}`;
  document.getElementById('chat-header-icon').innerHTML = '<path fill="currentColor" d="M5.886 21l.886-5.886H1.143v-1.745h5.886l.886-5.886H2.286V5.738h5.886l.886-4.738h1.745L9.917 5.738h5.886l.886-4.738h1.745l-.886 4.738h5.631v1.745h-5.886l-.886 5.886h5.631v1.745h-5.886L16.29 21h-1.745l.886-5.886H9.545L8.66 21H6.914zm3.543-7.631h5.886l.886-5.886H9.429l-.886 5.886z"/>';

  // Toggle member sidebar visibility based on state
  const memberSidebar = document.getElementById('member-sidebar');
  if (document.getElementById('btn-toggle-members').classList.contains('active')) {
    memberSidebar.classList.remove('hidden');
  } else {
    memberSidebar.classList.add('hidden');
  }

  // Load Message Feed
  await loadMessages();

  // Setup Message Realtime Subscription
  if (state.msgSub) state.msgSub.unsubscribe();
  
  state.msgSub = window.api.subscribeToMessages(channelId, 
    // On Insert
    async (newMessage) => {
      const messagesFeed = document.getElementById('message-feed');
      const msgItem = buildMessageHTML(newMessage);
      messagesFeed.appendChild(msgItem);
      scrollToBottom();
    },
    // On Delete
    (deletedMessageId) => {
      const element = document.getElementById(`message-${deletedMessageId}`);
      if (element) element.remove();
    },
    // On Update
    async (updatedMessage) => {
      const element = document.getElementById(`message-${updatedMessage.id}`);
      if (element) {
        // Just reload messages history to be safe and preserve correct profile models
        await loadMessages();
      }
    }
  );

  // Check Permissions: SEND_MESSAGES
  const canSend = await window.api.checkUserPermission(state.currentGuildId, state.currentUser.id, window.api.PERMISSIONS.SEND_MESSAGES);
  const inputArea = document.getElementById('message-input-area');
  const inputField = document.getElementById('message-input');
  
  if (canSend) {
    inputArea.classList.remove('hidden');
    inputField.disabled = false;
    inputField.value = '';
    inputField.placeholder = `Enviar un mensaje a #${channel.name}`;
  } else {
    inputArea.classList.remove('hidden');
    inputField.disabled = true;
    inputField.value = '';
    inputField.placeholder = `No tienes permisos para enviar mensajes en este canal.`;
  }
}

async function loadMessages() {
  try {
    const messages = await window.api.getMessages(state.currentChannelId);
    const container = document.getElementById('message-feed');
    container.innerHTML = '';
    
    messages.forEach(message => {
      container.appendChild(buildMessageHTML(message));
    });
    scrollToBottom();
  } catch (err) {
    console.error('Error fetching messages', err);
  }
}

function buildMessageHTML(message) {
  const item = document.createElement('div');
  item.className = 'message-item';
  item.id = `message-${message.id}`;

  const avatar = document.createElement('img');
  avatar.className = 'message-avatar';
  avatar.src = (message.profiles && message.profiles.avatar_url) ? message.profiles.avatar_url : 'https://cdn.discordapp.com/embed/avatars/0.png';
  item.appendChild(avatar);

  const contentBox = document.createElement('div');
  contentBox.className = 'message-content-box';

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = (message.profiles && (message.profiles.display_name || message.profiles.username)) || 'Usuario';
  
  // Color the author username according to their highest role color
  const authorRoles = state.memberRoles.filter(mr => mr.user_id === message.author_id);
  if (authorRoles.length > 0) {
    // Find matching role objects and sort by position to find highest
    const matchingRoles = state.roles.filter(r => authorRoles.some(ar => ar.role_id === r.id));
    if (matchingRoles.length > 0) {
      const highestRole = matchingRoles.reduce((highest, current) => (current.position > highest.position ? current : highest), matchingRoles[0]);
      if (highestRole && highestRole.color) {
        author.style.color = highestRole.color;
      }
    }
  }

  const timestamp = document.createElement('span');
  timestamp.className = 'message-timestamp';
  const msgDate = new Date(message.created_at);
  timestamp.textContent = msgDate.toLocaleString();

  meta.appendChild(author);
  meta.appendChild(timestamp);
  contentBox.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = message.content;
  contentBox.appendChild(text);

  item.appendChild(contentBox);

  // Message Options (Edit/Delete)
  const isAuthor = message.author_id === state.currentUser.id;
  const hasManageMessages = (state.currentPermissions & window.api.PERMISSIONS.MANAGE_MESSAGES) === window.api.PERMISSIONS.MANAGE_MESSAGES ||
                             (state.currentPermissions & window.api.PERMISSIONS.ADMINISTRATOR) === window.api.PERMISSIONS.ADMINISTRATOR;

  if (isAuthor || hasManageMessages) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    if (isAuthor) {
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => initiateEditMessage(message.id, text, message.content));
      actions.appendChild(editBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn delete-btn';
    delBtn.textContent = 'Eliminar';
    delBtn.addEventListener('click', async () => {
      if (confirm('¿Quieres eliminar este mensaje?')) {
        try {
          await window.api.deleteMessage(message.id);
        } catch (err) {
          alert('Error al eliminar mensaje: ' + err.message);
        }
      }
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);
  }

  return item;
}

function initiateEditMessage(messageId, textElement, currentContent) {
  // Replace text layout with edit text block
  const originalHTML = textElement.innerHTML;
  textElement.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'edit-message-container';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-message-input';
  input.value = currentContent;
  container.appendChild(input);

  const help = document.createElement('div');
  help.className = 'edit-message-help';
  help.innerHTML = `escape para <span>cancelar</span> • enter para <span>guardar</span>`;
  container.appendChild(help);

  textElement.appendChild(container);
  input.focus();

  // Bind key listeners
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      textElement.innerHTML = currentContent;
    } else if (e.key === 'Enter') {
      const newContent = input.value.trim();
      if (!newContent) return;
      try {
        await window.api.editMessage(messageId, newContent);
      } catch (err) {
        alert('Error al editar: ' + err.message);
        textElement.innerHTML = currentContent;
      }
    }
  });

  // Help buttons click listeners
  help.querySelectorAll('span')[0].addEventListener('click', () => {
    textElement.innerHTML = currentContent;
  });
  help.querySelectorAll('span')[1].addEventListener('click', async () => {
    const newContent = input.value.trim();
    if (!newContent) return;
    try {
      await window.api.editMessage(messageId, newContent);
    } catch (err) {
      alert('Error al editar: ' + err.message);
      textElement.innerHTML = currentContent;
    }
  });
}

function scrollToBottom() {
  const scroller = document.getElementById('messages-scroller');
  scroller.scrollTop = scroller.scrollHeight;
}

// -------------------------------------------------------------
// Members Sidebar List Rendering
// -------------------------------------------------------------
function renderMembersList() {
  const container = document.getElementById('member-sidebar');
  container.innerHTML = '';

  if (!state.currentGuildId) return;

  // Discord groups members by their highest role (with custom color representation)
  // Let's sort roles by hierarchy (position desc)
  const sortedRoles = [...state.roles].sort((a, b) => b.position - a.position);

  // Group members mapping
  const memberGroups = {};
  const ungroupedMembers = [];

  state.members.forEach(member => {
    const profile = member.profiles;
    if (!profile) return;

    // Get roles for this member
    const mRoles = state.memberRoles.filter(mr => mr.user_id === member.user_id && mr.guild_id === state.currentGuildId);
    
    if (mRoles.length === 0) {
      ungroupedMembers.push(member);
    } else {
      // Find highest hierarchy role
      const matchingRoles = state.roles.filter(r => mRoles.some(mr => mr.role_id === r.id));
      if (matchingRoles.length === 0) {
        ungroupedMembers.push(member);
      } else {
        const highestRole = matchingRoles.reduce((highest, current) => (current.position > highest.position ? current : highest), matchingRoles[0]);
        if (!memberGroups[highestRole.id]) {
          memberGroups[highestRole.id] = {
            role: highestRole,
            members: []
          };
        }
        memberGroups[highestRole.id].members.push(member);
      }
    }
  });

  // 1. Render Grouped Members
  sortedRoles.forEach(role => {
    if (role.name === '@everyone') return; // Skip @everyone role header grouping

    const group = memberGroups[role.id];
    if (group && group.members.length > 0) {
      // Create header
      const header = document.createElement('div');
      header.className = 'member-group-title';
      header.textContent = `${role.name} — ${group.members.length}`;
      container.appendChild(header);

      // Render members
      group.members.forEach(m => {
        container.appendChild(buildMemberCardHTML(m, role.color));
      });
    }
  });

  // 2. Render Online Members (No specific roles, or @everyone)
  // Sort ungrouped into online and offline
  const onlineUngrouped = ungroupedMembers.filter(m => m.profiles.status !== 'offline');
  const offlineUngrouped = ungroupedMembers.filter(m => m.profiles.status === 'offline');

  if (onlineUngrouped.length > 0) {
    const header = document.createElement('div');
    header.className = 'member-group-title';
    header.textContent = `En línea — ${onlineUngrouped.length}`;
    container.appendChild(header);

    onlineUngrouped.forEach(m => {
      container.appendChild(buildMemberCardHTML(m, '#b9bbbe'));
    });
  }

  if (offlineUngrouped.length > 0) {
    const header = document.createElement('div');
    header.className = 'member-group-title';
    header.textContent = `Sin conexión — ${offlineUngrouped.length}`;
    container.appendChild(header);

    offlineUngrouped.forEach(m => {
      container.appendChild(buildMemberCardHTML(m, '#80848e'));
    });
  }
}

function buildMemberCardHTML(member, roleColor) {
  const card = document.createElement('div');
  card.className = 'member-card';

  const avatarCont = document.createElement('div');
  avatarCont.className = 'avatar-container';

  const avatarImg = document.createElement('img');
  avatarImg.className = 'user-avatar';
  avatarImg.src = member.profiles.avatar_url ? member.profiles.avatar_url : 'https://cdn.discordapp.com/embed/avatars/0.png';

  const status = document.createElement('div');
  status.className = `status-indicator ${member.profiles.status || 'offline'}`;

  avatarCont.appendChild(avatarImg);
  avatarCont.appendChild(status);
  card.appendChild(avatarCont);

  const details = document.createElement('div');
  details.className = 'user-details';

  const name = document.createElement('span');
  name.className = 'member-details-name';
  name.textContent = member.nickname || member.profiles.display_name || member.profiles.username;
  name.style.color = roleColor;

  const statusText = document.createElement('span');
  statusText.className = 'member-details-status';
  statusText.textContent = member.profiles.custom_status || (member.profiles.status === 'offline' ? 'Desconectado' : 'Conectado');

  details.appendChild(name);
  details.appendChild(statusText);
  card.appendChild(details);

  return card;
}

// -------------------------------------------------------------
// WebRTC Voice Chat Logic
// -------------------------------------------------------------

// ICE servers (free STUN servers from Google)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

async function connectVoiceChannel(channel) {
  const hasView = (state.currentPermissions & window.api.PERMISSIONS.VIEW_CHANNEL) === window.api.PERMISSIONS.VIEW_CHANNEL ||
                  (state.currentPermissions & window.api.PERMISSIONS.ADMINISTRATOR) === window.api.PERMISSIONS.ADMINISTRATOR;
  if (!hasView) return alert('No tienes permisos para acceder a este canal');

  // If already in a voice channel, disconnect first
  if (state.voice.activeChannelId) {
    await disconnectVoiceChannel();
  }

  // Request microphone access
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    return alert('No se pudo acceder al micrófono: ' + err.message);
  }

  state.voice.localStream = localStream;
  state.voice.activeChannelId = channel.id;
  state.voice.activeGuildId = state.currentGuildId;
  state.voice.isMuted = false;
  state.voice.isDeafened = false;
  state.voice.peers = {};

  // Update the footer mic/deafen button states
  updateVoiceFooterUI();

  // Show the voice status bar
  const statusBar = document.getElementById('voice-status-bar');
  statusBar.classList.remove('hidden');
  const curGuild = state.guilds.find(g => g.id === state.currentGuildId);
  const guildName = curGuild ? curGuild.name : 'Servidor';
  statusBar.querySelector('.voice-channel-connected').textContent = `${channel.name} / ${guildName}`;

  // Set up AudioContext for local speaking detection
  state.voice.audioContext = new AudioContext();
  const source = state.voice.audioContext.createMediaStreamSource(localStream);
  const analyser = state.voice.audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  state.voice.localAnalyser = analyser;
  const localData = new Uint8Array(analyser.frequencyBinCount);
  state.voice.localSpeakingInterval = setInterval(() => {
    analyser.getByteFrequencyData(localData);
    const volume = localData.reduce((sum, v) => sum + v, 0) / localData.length;
    const speaking = volume > 8;
    const avatarEl = document.getElementById(`voice-avatar-${state.currentUser.id}`);
    if (avatarEl) {
      avatarEl.style.outline = speaking ? '2px solid var(--status-online)' : 'none';
    }
  }, 100);

  // Create Supabase Realtime channel for signaling
  const supabase = window.api.supabase;
  const signalingChanName = `voice_channel:${state.currentGuildId}:${channel.id}`;
  const sigChannel = supabase.channel(signalingChanName);

  sigChannel
    .on('presence', { event: 'sync' }, async () => {
      const presenceState = sigChannel.presenceState();
      const allPeers = [];
      Object.values(presenceState).forEach(presences => {
        presences.forEach(p => {
          if (p.user_id !== state.currentUser.id) allPeers.push(p);
        });
      });
      // Initiate connections to peers with smaller user_id (lexicographic offer/answer negotiation)
      for (const peer of allPeers) {
        if (!state.voice.peers[peer.user_id] && peer.user_id < state.currentUser.id) {
          await createPeerConnection(peer.user_id, true);
        }
      }
    })
    .on('presence', { event: 'join' }, async ({ newPresences }) => {
      for (const p of newPresences) {
        if (p.user_id !== state.currentUser.id && !state.voice.peers[p.user_id]) {
          // The peer with the lexicographically smaller ID sends the offer
          if (state.currentUser.id < p.user_id) {
            await createPeerConnection(p.user_id, true);
          }
        }
      }
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach(p => {
        if (p.user_id !== state.currentUser.id) {
          closePeer(p.user_id);
        }
      });
    })
    .on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (payload.target !== state.currentUser.id) return;
      const pc = await createPeerConnection(payload.from, false);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sigChannel.send({
        type: 'broadcast',
        event: 'answer',
        payload: { from: state.currentUser.id, target: payload.from, sdp: answer }
      });
    })
    .on('broadcast', { event: 'answer' }, async ({ payload }) => {
      if (payload.target !== state.currentUser.id) return;
      const peerEntry = state.voice.peers[payload.from];
      if (peerEntry && peerEntry.pc) {
        await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      }
    })
    .on('broadcast', { event: 'ice' }, async ({ payload }) => {
      if (payload.target !== state.currentUser.id) return;
      const peerEntry = state.voice.peers[payload.from];
      if (peerEntry && peerEntry.pc && payload.candidate) {
        try {
          await peerEntry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch(e) {}
      }
    })
    .subscribe(async (status, err) => {
      console.log(`[Signal Channel Subscription] ${signalingChanName} status:`, status, err || '');
      if (status === 'SUBSCRIBED') {
        // Track our presence in this voice channel
        const presencePayload = {
          user_id: state.currentUser.id,
          channel_id: channel.id,
          guild_id: state.currentGuildId,
          display_name: state.userProfile.display_name || state.userProfile.username,
          username: state.userProfile.username,
          avatar_url: state.userProfile.avatar_url || null,
          isMuted: false,
          isDeafened: false,
          speaking: false
        };
        console.log(`[Signal Channel Track] Tracking current user:`, presencePayload);
        const resSig = await sigChannel.track(presencePayload);
        console.log(`[Signal Channel Track Result]`, resSig);
        if (state.voice.guildPresenceSub) {
          console.log(`[Guild Presence Track] Tracking current user:`, presencePayload);
          const resGuild = await state.voice.guildPresenceSub.track(presencePayload);
          console.log(`[Guild Presence Track Result]`, resGuild);
        } else {
          console.warn(`[Guild Presence Track Warning] state.voice.guildPresenceSub is not set!`);
        }
      }
    });

  state.voice.presenceChannel = sigChannel;
  renderChannels();
}

async function createPeerConnection(peerId, isOfferer) {
  if (state.voice.peers[peerId]) return state.voice.peers[peerId].pc;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.voice.peers[peerId] = { pc, speakingInterval: null };

  // Add local audio tracks
  if (state.voice.localStream) {
    state.voice.localStream.getTracks().forEach(track => {
      pc.addTrack(track, state.voice.localStream);
    });
  }

  // ICE candidate exchange
  pc.onicecandidate = (event) => {
    if (event.candidate && state.voice.presenceChannel) {
      state.voice.presenceChannel.send({
        type: 'broadcast',
        event: 'ice',
        payload: { from: state.currentUser.id, target: peerId, candidate: event.candidate }
      });
    }
  };

  // When we receive remote audio
  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    // Play audio
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.autoplay = true;
    if (state.voice.isDeafened) audio.muted = true;
    audio.id = `audio-peer-${peerId}`;
    document.body.appendChild(audio);

    // Set up speaking detection for this remote peer
    if (state.voice.audioContext) {
      try {
        const remoteSource = state.voice.audioContext.createMediaStreamSource(remoteStream);
        const remoteAnalyser = state.voice.audioContext.createAnalyser();
        remoteAnalyser.fftSize = 512;
        remoteSource.connect(remoteAnalyser);
        const remoteData = new Uint8Array(remoteAnalyser.frequencyBinCount);
        const speakingInterval = setInterval(() => {
          remoteAnalyser.getByteFrequencyData(remoteData);
          const vol = remoteData.reduce((s, v) => s + v, 0) / remoteData.length;
          const isSpeaking = vol > 8;
          const avatarEl = document.getElementById(`voice-avatar-${peerId}`);
          if (avatarEl) {
            avatarEl.style.outline = isSpeaking ? '2px solid var(--status-online)' : 'none';
          }
        }, 100);
        if (state.voice.peers[peerId]) state.voice.peers[peerId].speakingInterval = speakingInterval;
      } catch (err) {
        console.error('Error establishing remote speaking detection analyser:', err);
      }
    }
  };

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (state.voice.presenceChannel) {
      state.voice.presenceChannel.send({
        type: 'broadcast',
        event: 'offer',
        payload: { from: state.currentUser.id, target: peerId, sdp: offer }
      });
    }
  }

  return pc;
}

function closePeer(peerId) {
  const peerEntry = state.voice.peers[peerId];
  if (!peerEntry) return;
  if (peerEntry.speakingInterval) clearInterval(peerEntry.speakingInterval);
  if (peerEntry.pc) peerEntry.pc.close();
  const audioEl = document.getElementById(`audio-peer-${peerId}`);
  if (audioEl) audioEl.remove();
  delete state.voice.peers[peerId];
}

async function disconnectVoiceChannel() {
  // Clean up all peers
  Object.keys(state.voice.peers).forEach(peerId => closePeer(peerId));
  state.voice.peers = {};

  // Stop local mic
  if (state.voice.localStream) {
    state.voice.localStream.getTracks().forEach(t => t.stop());
    state.voice.localStream = null;
  }

  // Stop speaking detection
  if (state.voice.localSpeakingInterval) {
    clearInterval(state.voice.localSpeakingInterval);
    state.voice.localSpeakingInterval = null;
  }

  // Close AudioContext
  if (state.voice.audioContext) {
    state.voice.audioContext.close();
    state.voice.audioContext = null;
    state.voice.localAnalyser = null;
  }

  // Unsubscribe and remove signaling channel from client cache
  if (state.voice.presenceChannel) {
    await supabase.removeChannel(state.voice.presenceChannel);
    state.voice.presenceChannel = null;
  }

  // Untrack user from guild presence channel but do not remove the channel
  if (state.voice.guildPresenceSub) {
    await state.voice.guildPresenceSub.untrack();
  }

  state.voice.activeChannelId = null;
  state.voice.activeGuildId = null;
  state.voice.isMuted = false;
  state.voice.isDeafened = false;

  // Hide the status bar
  document.getElementById('voice-status-bar').classList.add('hidden');

  // Reset footer button states
  updateVoiceFooterUI();

  renderChannels();
}

function updateVoiceFooterUI() {
  const micBtn = document.getElementById('btn-toggle-mic');
  const deafBtn = document.getElementById('btn-toggle-audio');
  if (state.voice.isMuted || state.voice.isDeafened) {
    micBtn.classList.add('active');
  } else {
    micBtn.classList.remove('active');
  }
  if (state.voice.isDeafened) {
    deafBtn.classList.add('active');
  } else {
    deafBtn.classList.remove('active');
  }
}

function toggleMute() {
  if (!state.voice.localStream) return; // Not in voice
  state.voice.isMuted = !state.voice.isMuted;
  state.voice.localStream.getAudioTracks().forEach(t => { t.enabled = !state.voice.isMuted; });
  updateVoiceFooterUI();
  // Update presence
  const presencePayload = {
    user_id: state.currentUser.id,
    channel_id: state.voice.activeChannelId,
    guild_id: state.voice.activeGuildId,
    display_name: state.userProfile.display_name || state.userProfile.username,
    username: state.userProfile.username,
    avatar_url: state.userProfile.avatar_url || null,
    isMuted: state.voice.isMuted,
    isDeafened: state.voice.isDeafened,
    speaking: false
  };
  if (state.voice.presenceChannel) {
    state.voice.presenceChannel.track(presencePayload);
  }
  if (state.voice.guildPresenceSub) {
    state.voice.guildPresenceSub.track(presencePayload);
  }
  renderChannels();
}

function toggleDeafen() {
  if (!state.voice.localStream) return; // Not in voice
  state.voice.isDeafened = !state.voice.isDeafened;
  if (state.voice.isDeafened) {
    // Mute local mic too when deafened (Discord behavior)
    state.voice.isMuted = true;
    state.voice.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
  } else {
    state.voice.isMuted = false;
    state.voice.localStream.getAudioTracks().forEach(t => { t.enabled = true; });
  }
  // Mute/unmute all remote audio elements
  Object.keys(state.voice.peers).forEach(peerId => {
    const audioEl = document.getElementById(`audio-peer-${peerId}`);
    if (audioEl) audioEl.muted = state.voice.isDeafened;
  });
  updateVoiceFooterUI();
  const presencePayload = {
    user_id: state.currentUser.id,
    channel_id: state.voice.activeChannelId,
    guild_id: state.voice.activeGuildId,
    display_name: state.userProfile.display_name || state.userProfile.username,
    username: state.userProfile.username,
    avatar_url: state.userProfile.avatar_url || null,
    isMuted: state.voice.isMuted,
    isDeafened: state.voice.isDeafened,
    speaking: false
  };
  if (state.voice.presenceChannel) {
    state.voice.presenceChannel.track(presencePayload);
  }
  if (state.voice.guildPresenceSub) {
    state.voice.guildPresenceSub.track(presencePayload);
  }
  renderChannels();
}

function toggleStatusPicker(e) {
  if (e) e.stopPropagation();
  const picker = document.getElementById('status-picker');
  picker.classList.toggle('hidden');
}

// -------------------------------------------------------------
// Core Actions & Modals Bindings
// -------------------------------------------------------------
function setupAppEventListeners() {
  // Message Sending
  const messageInput = document.getElementById('message-input');
  messageInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const content = messageInput.value.trim();
      if (!content) return;

      messageInput.value = '';

      if (state.currentDMUserId) {
        sendDM(content);
      } else if (state.currentChannelId) {
        try {
          await window.api.sendMessage(state.currentChannelId, content);
        } catch (err) {
          alert('Error al enviar mensaje: ' + err.message);
        }
      }
    }
  });

  // Attach mock actions
  document.getElementById('btn-message-attach').addEventListener('click', () => alert('Característica de archivos adjuntos (Simulado).'));
  document.getElementById('btn-message-emoji').addEventListener('click', () => alert('Característica de emojis (Simulado).'));
  
  // Home click
  document.getElementById('btn-home').addEventListener('click', () => selectHome());

  // Show Server modal (Create/Join choices)
  document.getElementById('btn-add-server').addEventListener('click', () => {
    showModal('server-modal');
    showServerChoices();
  });
  document.getElementById('btn-join-server-trigger').addEventListener('click', () => {
    showModal('server-modal');
    showServerJoinForm();
  });

  // Modal Choices Transitions
  document.getElementById('btn-create-server-choice').addEventListener('click', () => {
    document.getElementById('server-choices').classList.add('hidden');
    document.getElementById('server-create-form').classList.remove('hidden');
  });
  document.getElementById('btn-join-server-choice').addEventListener('click', () => {
    document.getElementById('server-choices').classList.add('hidden');
    document.getElementById('server-join-form').classList.remove('hidden');
  });

  document.getElementById('btn-back-choices-1').addEventListener('click', showServerChoices);
  document.getElementById('btn-back-choices-2').addEventListener('click', showServerChoices);

  // Submit Create Server
  document.getElementById('btn-submit-create-server').addEventListener('click', async () => {
    const input = document.getElementById('new-server-name');
    const btn = document.getElementById('btn-submit-create-server');
    const name = input.value.trim();
    if (!name) return alert('Debes ingresar un nombre');
    
    input.disabled = true;
    btn.disabled = true;
    btn.textContent = 'Creando...';
    
    try {
      const response = await window.api.createGuild(name);
      closeModal();
      await loadGuilds();
      selectGuild(response.guild_id);
    } catch (err) {
      alert('Error al crear servidor: ' + err.message);
    } finally {
      input.disabled = false;
      btn.disabled = false;
      btn.textContent = 'Crear';
    }
  });

  // Submit Join Server
  document.getElementById('btn-submit-join-server').addEventListener('click', async () => {
    const input = document.getElementById('join-invite-code');
    const btn = document.getElementById('btn-submit-join-server');
    const code = input.value.trim();
    if (!code) return alert('Debes ingresar un código de invitación');
    
    input.disabled = true;
    btn.disabled = true;
    btn.textContent = 'Uniéndose...';
    
    try {
      const response = await window.api.joinGuildByInvite(code);
      closeModal();
      await loadGuilds();
      selectGuild(response.guild_id);
    } catch (err) {
      alert('Error al unirse al servidor: ' + err.message);
    } finally {
      input.disabled = false;
      btn.disabled = false;
      btn.textContent = 'Unirse al servidor';
    }
  });

  // Toggle Members Sidebar
  document.getElementById('btn-toggle-members').addEventListener('click', () => {
    const btn = document.getElementById('btn-toggle-members');
    const sidebar = document.getElementById('member-sidebar');
    if (btn.classList.contains('active')) {
      btn.classList.remove('active');
      sidebar.classList.add('hidden');
    } else {
      btn.classList.add('active');
      sidebar.classList.remove('hidden');
    }
  });

  // Create Invite modal triggers
  document.getElementById('btn-create-invite').addEventListener('click', async () => {
    if (!state.currentGuildId || !state.currentChannelId) return;

    // Check permissions
    const canInvite = await window.api.checkUserPermission(state.currentGuildId, state.currentUser.id, window.api.PERMISSIONS.CREATE_INSTANT_INVITE);
    if (!canInvite) return alert('No tienes permisos para crear invitaciones en este servidor');

    const guild = state.guilds.find(g => g.id === state.currentGuildId);
    document.getElementById('invite-server-name').textContent = guild.name;
    
    // Generate code first with defaults (duration 7 days, infinite uses)
    await generateInviteCode();
    showModal('invite-modal');
  });

  document.getElementById('btn-generate-new-invite').addEventListener('click', generateInviteCode);
  
  // Copy Invite link
  document.getElementById('btn-copy-invite').addEventListener('click', () => {
    const urlInput = document.getElementById('generated-invite-url');
    urlInput.select();
    navigator.clipboard.writeText(urlInput.value);
    
    const copyBtn = document.getElementById('btn-copy-invite');
    copyBtn.textContent = '¡Copiado!';
    copyBtn.style.backgroundColor = 'var(--status-online)';
    setTimeout(() => {
      copyBtn.textContent = 'Copiar';
      copyBtn.style.backgroundColor = 'var(--brand-color)';
    }, 2000);
  });

  // Voice controls
  document.getElementById('btn-voice-disconnect').addEventListener('click', disconnectVoiceChannel);
  document.getElementById('btn-toggle-mic').addEventListener('click', toggleMute);
  document.getElementById('btn-toggle-audio').addEventListener('click', toggleDeafen);

  // User Settings Triggers
  document.getElementById('btn-user-settings').addEventListener('click', () => showSettingsModal('user-settings-modal'));
  document.getElementById('btn-profile-trigger').addEventListener('click', toggleStatusPicker);

  // Status Picker click items
  const pickerItems = document.querySelectorAll('.status-picker-item[data-status]');
  pickerItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const status = item.getAttribute('data-status');
      document.getElementById('status-picker').classList.add('hidden');
      
      try {
        state.userProfile = await window.api.updateUserProfile({
          status: status
        });
        updateUserProfileUI();
      } catch (err) {
        alert('Error al actualizar estado: ' + err.message);
      }
    });
  });

  // Settings trigger in Status Picker
  document.getElementById('btn-status-picker-settings').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('status-picker').classList.add('hidden');
    showSettingsModal('user-settings-modal');
  });

  // Global click to close Status Picker when clicking outside
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('status-picker');
    const trigger = document.getElementById('btn-profile-trigger');
    if (picker && !picker.classList.contains('hidden')) {
      if (!picker.contains(e.target) && !trigger.contains(e.target)) {
        picker.classList.add('hidden');
      }
    }
  });

  // Friends tab switching
  const friendsTabs = document.querySelectorAll('.friends-tab');
  friendsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      friendsTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabName = tab.getAttribute('data-tab');
      if (tabName === 'add') {
        document.getElementById('friends-list').classList.add('hidden');
        document.getElementById('add-friend-form-box').classList.remove('hidden');
        document.getElementById('add-friend-message').textContent = '';
        document.getElementById('add-friend-username-input').value = '';
      } else {
        document.getElementById('friends-list').classList.remove('hidden');
        document.getElementById('add-friend-form-box').classList.add('hidden');
        loadFriends(tabName);
      }
    });
  });

  // Friend Request Submission
  document.getElementById('btn-submit-friend-request').addEventListener('click', async () => {
    const usernameInput = document.getElementById('add-friend-username-input');
    const username = usernameInput.value.trim();
    const messageEl = document.getElementById('add-friend-message');
    if (!username) return;

    messageEl.style.color = 'var(--text-muted)';
    messageEl.textContent = 'Buscando usuario...';

    try {
      const profiles = await window.api.getProfiles();
      const match = profiles.find(p => p.username.toLowerCase() === username.toLowerCase());
      
      if (!match) {
        messageEl.style.color = 'var(--status-dnd)';
        messageEl.textContent = `No se pudo encontrar a un usuario con el nombre "${username}".`;
      } else if (match.id === state.currentUser.id) {
        messageEl.style.color = 'var(--status-dnd)';
        messageEl.textContent = 'No puedes agregarte a ti mismo como amigo.';
      } else {
        if (!state.addedFriendIds) {
          state.addedFriendIds = new Set();
        }
        state.addedFriendIds.add(match.id);
        messageEl.style.color = 'var(--status-online)';
        messageEl.textContent = `¡Solicitud de amistad enviada con éxito a ${match.username}! (Simulado)`;
        usernameInput.value = '';
      }
    } catch (err) {
      messageEl.style.color = 'var(--status-dnd)';
      messageEl.textContent = 'Error al enviar solicitud: ' + err.message;
    }
  });

  // Channel Create Modal Type Switch Prefix updates
  document.querySelectorAll('input[name="modal-new-channel-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const prefix = e.target.value === 'voice' ? '🔊' : '#';
      document.getElementById('channel-modal-prefix').textContent = prefix;
    });
  });

  // Submit Create Channel
  document.getElementById('btn-modal-submit-create-channel').addEventListener('click', async () => {
    const nameInput = document.getElementById('modal-new-channel-name');
    const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    const type = document.querySelector('input[name="modal-new-channel-type"]:checked').value;
    
    if (!name) return alert('Debes ingresar un nombre para el canal');
    
    const btn = document.getElementById('btn-modal-submit-create-channel');
    btn.disabled = true;
    btn.textContent = 'Creando...';
    
    try {
      const newChan = await window.api.createChannel(state.currentGuildId, name, type);
      closeModal();
      // Reload channels
      state.channels = await window.api.getGuildChannels(state.currentGuildId);
      renderChannels();
      
      // Select the channel if it's a text channel
      if (type === 'text') {
        selectChannel(newChan.id);
      }
    } catch (err) {
      alert('Error al crear canal: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear canal';
    }
  });

  // Submit Edit/Rename Channel
  document.getElementById('btn-modal-submit-edit-channel').addEventListener('click', async () => {
    if (!currentEditingChannel) return;
    
    const nameInput = document.getElementById('modal-edit-channel-name');
    const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return alert('Debes ingresar un nombre para el canal');
    
    const btn = document.getElementById('btn-modal-submit-edit-channel');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    
    try {
      await window.api.updateChannel(currentEditingChannel.id, name);
      closeModal();
      
      // Refresh
      state.channels = await window.api.getGuildChannels(state.currentGuildId);
      renderChannels();
      
      // If we edited the active channel, update header
      if (state.currentChannelId === currentEditingChannel.id) {
        selectChannel(currentEditingChannel.id);
      }
    } catch (err) {
      alert('Error al guardar canal: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  });

  // Delete Channel from Modal
  document.getElementById('btn-modal-delete-channel').addEventListener('click', async () => {
    if (!currentEditingChannel) return;
    
    const confirmMsg = currentEditingChannel.type === 'voice' 
      ? `¿Estás seguro de que quieres eliminar el canal de voz ${currentEditingChannel.name}?`
      : `¿Estás seguro de que quieres eliminar el canal de texto #${currentEditingChannel.name}?`;
      
    if (confirm(confirmMsg)) {
      const btn = document.getElementById('btn-modal-delete-channel');
      btn.disabled = true;
      btn.textContent = 'Eliminando...';
      
      try {
        await window.api.deleteChannel(currentEditingChannel.id);
        closeModal();
        
        // Refresh channels list
        state.channels = await window.api.getGuildChannels(state.currentGuildId);
        renderChannels();
        
        // If we deleted the active channel, redirect
        if (state.currentChannelId === currentEditingChannel.id) {
          selectGuild(state.currentGuildId);
        }
      } catch (err) {
        alert('Error al borrar canal: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Eliminar canal';
      }
    }
  });

  // User Settings Save
  document.getElementById('btn-save-user-profile').addEventListener('click', async () => {
    const displayName = document.getElementById('settings-display-name').value.trim();
    const avatarUrl = document.getElementById('settings-avatar-url').value.trim();
    const status = document.getElementById('settings-user-status').value;

    const btn = document.getElementById('btn-save-user-profile');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      state.userProfile = await window.api.updateUserProfile({
        display_name: displayName,
        avatar_url: avatarUrl || null,
        status: status
      });
      updateUserProfileUI();
      closeSettingsModal();
    } catch (err) {
      alert('Error al guardar perfil: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  });

  // User Settings Logout
  document.getElementById('btn-settings-logout').addEventListener('click', async () => {
    if (confirm('¿Quieres cerrar sesión?')) {
      try {
        await window.api.signOut();
        closeSettingsModal();
        location.reload();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  });

  // Guild Settings trigger
  document.getElementById('guild-settings-trigger').addEventListener('click', () => {
    // Open guild settings and populate
    showSettingsModal('server-settings-modal');
    setupGuildSettingsTabs();
    loadGuildSettingsOverview();
  });
}

// Helper to generate and render invite code in modal
async function generateInviteCode() {
  const duration = document.getElementById('invite-duration').value;
  const maxUses = Number(document.getElementById('invite-max-uses').value);
  try {
    const invite = await window.api.createInvite(state.currentGuildId, state.currentChannelId, maxUses, duration);
    document.getElementById('generated-invite-url').value = invite.code;
  } catch (err) {
    alert('Error al crear código de invitación: ' + err.message);
  }
}

// Show Choices forms helpers
function showServerChoices() {
  document.getElementById('server-choices').classList.remove('hidden');
  document.getElementById('server-create-form').classList.add('hidden');
  document.getElementById('server-join-form').classList.add('hidden');
  
  // reset inputs
  document.getElementById('new-server-name').value = '';
  document.getElementById('join-invite-code').value = '';
}

function showServerJoinForm() {
  document.getElementById('server-choices').classList.add('hidden');
  document.getElementById('server-create-form').classList.add('hidden');
  document.getElementById('server-join-form').classList.remove('hidden');
}

// -------------------------------------------------------------
// Modals View Controls
// -------------------------------------------------------------
function showModal(modalId) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  
  // hide all modals inside overlay
  const modals = document.getElementById('modal-overlay').querySelectorAll('.modal-box');
  modals.forEach(m => m.classList.add('hidden'));

  document.getElementById(modalId).classList.remove('hidden');
}

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.add('hidden');
};

function showSettingsModal(modalId) {
  // For fullscreen settings panels, we load them inside the main overlay
  document.getElementById('modal-overlay').classList.remove('hidden');
  
  // hide other modals
  const modals = document.getElementById('modal-overlay').querySelectorAll('.modal-box');
  modals.forEach(m => m.classList.add('hidden'));

  const settingsModal = document.getElementById(modalId);
  settingsModal.classList.remove('hidden');

  // Load configuration previews
  if (modalId === 'user-settings-modal') {
    document.getElementById('settings-display-name').value = state.userProfile.display_name || '';
    document.getElementById('settings-username').value = state.userProfile.username || '';
    document.getElementById('settings-avatar-url').value = state.userProfile.avatar_url || '';
    document.getElementById('settings-user-status').value = state.userProfile.status || 'online';
    document.getElementById('settings-avatar-preview').src = state.userProfile.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

window.closeSettingsModal = function() {
  document.getElementById('modal-overlay').classList.add('hidden');
  
  // hide settings modals explicitly
  document.getElementById('user-settings-modal').classList.add('hidden');
  document.getElementById('server-settings-modal').classList.add('hidden');
};

// -------------------------------------------------------------
// Guild (Server) Settings panel manager
// -------------------------------------------------------------
function setupGuildSettingsTabs() {
  const tabs = document.querySelectorAll('#server-settings-modal .settings-sidebar-item');
  const views = document.querySelectorAll('.guild-settings-tab-view');
  
  // Clear tabs listener
  tabs.forEach(tab => {
    // Ignore Delete action trigger
    if (tab.id === 'btn-delete-guild-trigger') return;

    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      views.forEach(v => v.classList.add('hidden'));
      
      const targetId = tab.id.replace('tab-guild-', 'view-guild-');
      document.getElementById(targetId).classList.remove('hidden');

      // Refresh data accordingly
      if (tab.id === 'tab-guild-roles') loadGuildSettingsRoles();
      else if (tab.id === 'tab-guild-members') loadGuildSettingsMembers();
    };
  });

  // Re-bind delete button
  const delBtn = document.getElementById('btn-delete-guild-trigger');
  delBtn.onclick = async () => {
    // Only owner can delete
    const guild = state.guilds.find(g => g.id === state.currentGuildId);
    if (guild.owner_id !== state.currentUser.id) {
      alert('Solo el propietario del servidor puede eliminarlo.');
      return;
    }

    if (confirm(`¿Estás COMPLETAMENTE seguro de que quieres eliminar el servidor ${guild.name}? Esta acción no se puede deshacer.`)) {
      try {
        await window.api.deleteGuild(state.currentGuildId);
        closeSettingsModal();
        await bootstrapApp();
      } catch (err) {
        alert('Error al eliminar servidor: ' + err.message);
      }
    }
  };

  // Reset tabs to default (Overview)
  tabs.forEach(t => t.classList.remove('active'));
  document.getElementById('tab-guild-overview').classList.add('active');
  views.forEach(v => v.classList.add('hidden'));
  document.getElementById('view-guild-overview').classList.remove('hidden');
}

function loadGuildSettingsOverview() {
  const guild = state.guilds.find(g => g.id === state.currentGuildId);
  document.getElementById('settings-server-sidebar-title').textContent = guild.name.toUpperCase();
  document.getElementById('settings-guild-name').value = guild.name;
  document.getElementById('settings-guild-icon-url').value = guild.icon_url || '';

  // Save button overview
  document.getElementById('btn-save-guild-overview').onclick = async () => {
    const name = document.getElementById('settings-guild-name').value.trim();
    const iconUrl = document.getElementById('settings-guild-icon-url').value.trim();
    if (!name) return alert('El nombre es requerido');
    
    try {
      await window.api.updateGuildOverview(state.currentGuildId, name, iconUrl || null);
      closeSettingsModal();
      await bootstrapApp();
    } catch (err) {
      alert('Error al guardar ajustes: ' + err.message);
    }
  };
}



// Roles and permissions view inside settings
let activeEditRoleId = null;
function loadGuildSettingsRoles() {
  const container = document.getElementById('guild-settings-roles-list');
  container.innerHTML = '';

  state.roles.forEach(role => {
    const item = document.createElement('div');
    item.className = 'role-manage-list-item';
    if (activeEditRoleId === role.id) item.classList.add('active');
    
    const dot = document.createElement('div');
    dot.className = 'role-dot';
    dot.style.backgroundColor = role.color;

    const span = document.createElement('span');
    span.textContent = role.name;

    item.appendChild(dot);
    item.appendChild(span);
    
    item.onclick = () => selectRoleToEdit(role);
    container.appendChild(item);
  });

  // Create role button
  document.getElementById('btn-create-role-trigger').onclick = async () => {
    const rName = prompt('Ingresa el nombre del rol:');
    if (!rName) return;
    try {
      const newRole = await window.api.createRole(state.currentGuildId, rName, '#5865f2', 68608); // default perms: read/send/history
      state.roles = await window.api.getGuildRoles(state.currentGuildId);
      activeEditRoleId = newRole.id;
      loadGuildSettingsRoles();
      selectRoleToEdit(newRole);
    } catch (err) {
      alert('Error al crear rol: ' + err.message);
    }
  };
}

function selectRoleToEdit(role) {
  activeEditRoleId = role.id;
  
  // Highlight in sidebar
  const items = document.querySelectorAll('.role-manage-list-item');
  items.forEach(it => {
    if (it.querySelector('span').textContent === role.name) {
      it.classList.add('active');
    } else {
      it.classList.remove('active');
    }
  });

  const pane = document.getElementById('role-editor-config-pane');
  pane.classList.remove('hidden');

  document.getElementById('role-editor-title-name').textContent = `Editar rol: ${role.name}`;
  document.getElementById('edit-role-name').value = role.name;
  document.getElementById('edit-role-color-picker').value = role.color;
  document.getElementById('edit-role-color-text').value = role.color;

  // Bind color input syncing
  document.getElementById('edit-role-color-picker').oninput = (e) => {
    document.getElementById('edit-role-color-text').value = e.target.value;
  };
  document.getElementById('edit-role-color-text').oninput = (e) => {
    const val = e.target.value;
    if (val.match(/^#[0-9a-fA-F]{6}$/)) {
      document.getElementById('edit-role-color-picker').value = val;
    }
  };

  // Render permissions checkbox list with corresponding state checks
  const list = document.getElementById('role-edit-permissions-list');
  list.innerHTML = '';

  const permissionsMetadata = [
    { bit: window.api.PERMISSIONS.ADMINISTRATOR, name: 'Administrador', desc: 'Otorga todos los permisos. Peligroso.' },
    { bit: window.api.PERMISSIONS.MANAGE_GUILD, name: 'Gestionar Servidor', desc: 'Permite editar el nombre y el icono del servidor.' },
    { bit: window.api.PERMISSIONS.MANAGE_CHANNELS, name: 'Gestionar Canales', desc: 'Permite crear, borrar y renombrar canales.' },
    { bit: window.api.PERMISSIONS.MANAGE_ROLES, name: 'Gestionar Roles', desc: 'Permite crear, borrar y editar permisos de roles.' },
    { bit: window.api.PERMISSIONS.CREATE_INSTANT_INVITE, name: 'Crear Invitación', desc: 'Permite invitar usuarios al servidor.' },
    { bit: window.api.PERMISSIONS.KICK_MEMBERS, name: 'Expulsar Miembros', desc: 'Permite expulsar miembros del servidor.' },
    { bit: window.api.PERMISSIONS.VIEW_CHANNEL, name: 'Ver Canales', desc: 'Permite ver los canales e ingresar en ellos.' },
    { bit: window.api.PERMISSIONS.SEND_MESSAGES, name: 'Enviar Mensajes', desc: 'Permite chatear en canales de texto.' },
    { bit: window.api.PERMISSIONS.MANAGE_MESSAGES, name: 'Gestionar Mensajes', desc: 'Permite eliminar y editar mensajes de otros usuarios.' }
  ];

  const currentRolePerms = BigInt(role.permissions);

  permissionsMetadata.forEach(meta => {
    const isChecked = (currentRolePerms & meta.bit) === meta.bit;
    const item = document.createElement('label');
    item.className = 'checkbox-label';
    item.innerHTML = `
      <input type="checkbox" class="perm-checkbox" data-bit="${meta.bit}" ${isChecked ? 'checked' : ''}>
      <div class="checkbox-label-text">
        <span class="checkbox-title">${meta.name}</span>
        <span class="checkbox-description">${meta.desc}</span>
      </div>
    `;
    list.appendChild(item);
  });

  // Cannot delete @everyone role
  const isEveryone = role.name === '@everyone';
  const delBtn = document.getElementById('btn-delete-role');
  if (isEveryone) {
    delBtn.classList.add('hidden');
    document.getElementById('edit-role-name').disabled = true;
  } else {
    delBtn.classList.remove('hidden');
    document.getElementById('edit-role-name').disabled = false;
  }

  // Delete role handler
  delBtn.onclick = async () => {
    if (confirm(`¿Quieres eliminar el rol ${role.name}?`)) {
      try {
        await window.api.deleteRole(role.id);
        state.roles = await window.api.getGuildRoles(state.currentGuildId);
        pane.classList.add('hidden');
        activeEditRoleId = null;
        loadGuildSettingsRoles();
      } catch (err) {
        alert('Error al eliminar rol: ' + err.message);
      }
    }
  };

  // Save Role config handler
  document.getElementById('btn-save-role-settings').onclick = async () => {
    const name = document.getElementById('edit-role-name').value.trim();
    const color = document.getElementById('edit-role-color-text').value.trim();
    if (!name) return alert('El nombre de rol es requerido');

    // Recalculate permission sum
    let permissionSum = 0n;
    const checkboxes = list.querySelectorAll('.perm-checkbox');
    checkboxes.forEach(box => {
      if (box.checked) {
        permissionSum |= BigInt(box.getAttribute('data-bit'));
      }
    });

    try {
      await window.api.updateRole(role.id, name, color, permissionSum);
      state.roles = await window.api.getGuildRoles(state.currentGuildId);
      loadGuildSettingsRoles();
      alert('Rol guardado correctamente.');
    } catch (err) {
      alert('Error al guardar rol: ' + err.message);
    }
  };
}

// Members and roles assignations Tab inside settings
function loadGuildSettingsMembers() {
  const container = document.getElementById('guild-settings-members-list');
  container.innerHTML = '';

  const ownerId = state.guilds.find(g => g.id === state.currentGuildId).owner_id;

  state.members.forEach(member => {
    const p = member.profiles;
    if (!p) return;

    const row = document.createElement('div');
    row.className = 'member-manage-item';

    const info = document.createElement('div');
    info.className = 'member-manage-item-info';
    info.innerHTML = `
      <img class="user-avatar" src="${p.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:32px; height:32px;">
      <span class="member-manage-item-name">${p.display_name || p.username}</span>
    `;
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'member-manage-item-actions';

    // Renders roles container badge list
    const rolesDiv = document.createElement('div');
    rolesDiv.className = 'member-roles-container';

    const mRoles = state.memberRoles.filter(mr => mr.user_id === member.user_id && mr.guild_id === state.currentGuildId);
    
    mRoles.forEach(mRole => {
      const rObj = state.roles.find(r => r.id === mRole.role_id);
      if (rObj && rObj.name !== '@everyone') {
        const badge = document.createElement('div');
        badge.className = 'member-role-badge';
        badge.innerHTML = `
          <span style="color:${rObj.color}">${rObj.name}</span>
          <span class="role-badge-remove" onclick="removeMemberRole('${member.user_id}', '${rObj.id}')">×</span>
        `;
        rolesDiv.appendChild(badge);
      }
    });

    // Add role button trigger
    const addRoleBtn = document.createElement('button');
    addRoleBtn.className = 'btn-add-role-member';
    addRoleBtn.textContent = '+';
    addRoleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddRoleMenu(addRoleBtn, member.user_id, mRoles);
    });

    rolesDiv.appendChild(addRoleBtn);
    actions.appendChild(rolesDiv);

    // Cannot kick the owner or yourself
    if (member.user_id !== ownerId && member.user_id !== state.currentUser.id) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn btn-secondary btn-sm';
      kickBtn.style.backgroundColor = 'var(--status-dnd)';
      kickBtn.textContent = 'Expulsar';
      kickBtn.onclick = async () => {
        if (confirm(`¿Seguro que quieres expulsar a ${p.display_name || p.username} del servidor?`)) {
          try {
            await window.api.kickMember(state.currentGuildId, member.user_id);
            await loadGuildMembers();
            loadGuildSettingsMembers();
          } catch (err) {
            alert('Error al expulsar miembro: ' + err.message);
          }
        }
      };
      actions.appendChild(kickBtn);
    } else if (member.user_id === ownerId) {
      const ownerLabel = document.createElement('span');
      ownerLabel.style.fontSize = '12px';
      ownerLabel.style.fontWeight = '600';
      ownerLabel.style.color = 'var(--status-idle)';
      ownerLabel.textContent = 'Propietario';
      actions.appendChild(ownerLabel);
    }

    row.appendChild(actions);
    container.appendChild(row);
  });
}

// Sub menu dropdown for adding roles to a member
let activeRolePopover = null;
function openAddRoleMenu(triggerElement, userId, currentRoles) {
  if (activeRolePopover) activeRolePopover.remove();

  const popover = document.createElement('div');
  popover.className = 'role-dropdown-popover';

  // Find remaining assignable roles (skip @everyone and already assigned)
  const assignableRoles = state.roles.filter(r => r.name !== '@everyone' && !currentRoles.some(cr => cr.role_id === r.id));

  if (assignableRoles.length === 0) {
    popover.innerHTML = `<div style="padding:6px 12px; font-size:12px; color:var(--text-muted);">Sin roles disponibles</div>`;
  } else {
    assignableRoles.forEach(role => {
      const item = document.createElement('div');
      item.className = 'role-dropdown-item';
      item.innerHTML = `
        <div class="role-dot" style="background-color:${role.color};"></div>
        <span>${role.name}</span>
      `;
      item.onclick = async () => {
        try {
          await window.api.assignRoleToMember(state.currentGuildId, userId, role.id);
          popover.remove();
          // reload member roles in details
          state.memberRoles = await window.api.getMemberRoles(state.currentGuildId);
          loadGuildSettingsMembers();
          renderMembersList();
        } catch (err) {
          alert('Error al asignar rol: ' + err.message);
        }
      };
      popover.appendChild(item);
    });
  }

  document.body.appendChild(popover);
  activeRolePopover = popover;

  // Position popover right under trigger
  const rect = triggerElement.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
  popover.style.left = `${rect.left + window.scrollX}px`;

  // Close when clicking outside
  const handleBodyClick = (e) => {
    if (!popover.contains(e.target) && e.target !== triggerElement) {
      popover.remove();
      document.body.removeEventListener('click', handleBodyClick);
    }
  };
  // delay listener registration so trigger click doesn't immediately close
  setTimeout(() => document.body.addEventListener('click', handleBodyClick), 50);
}

window.removeMemberRole = async function(userId, roleId) {
  try {
    await window.api.removeRoleFromMember(state.currentGuildId, userId, roleId);
    state.memberRoles = await window.api.getMemberRoles(state.currentGuildId);
    loadGuildSettingsMembers();
    renderMembersList();
  } catch (err) {
    alert('Error al remover rol: ' + err.message);
  }
};

// -------------------------------------------------------------
// Friends List & DM Simulation helper functions
// -------------------------------------------------------------
async function loadFriends(tab = 'online') {
  const friendsList = document.getElementById('friends-list');
  if (!friendsList) return;
  
  if (!state.addedFriendIds) {
    state.addedFriendIds = new Set();
    // Pre-populate with all other user profiles we can load initially
    try {
      const profiles = await window.api.getProfiles();
      profiles.forEach(p => {
        if (p.id !== state.currentUser.id) {
          state.addedFriendIds.add(p.id);
        }
      });
    } catch(e) {}
  }
  
  friendsList.innerHTML = '<div style="padding:20px; color:var(--text-muted); text-align:center;">Cargando amigos...</div>';

  try {
    const profiles = await window.api.getProfiles();
    state.allProfiles = profiles; // cache them
    
    // Render DM list in sidebar as well!
    const otherProfiles = profiles.filter(p => p.id !== state.currentUser.id);
    renderDMsSidebar(otherProfiles);

    let filtered = otherProfiles.filter(p => state.addedFriendIds.has(p.id));
    if (tab === 'online') {
      filtered = filtered.filter(p => p.status && p.status !== 'offline');
    }

    friendsList.innerHTML = '';
    if (filtered.length === 0) {
      friendsList.innerHTML = `
        <div style="padding:40px; color:var(--text-muted); text-align:center;">
          No hay nadie en esta lista.
        </div>
      `;
      return;
    }

    filtered.forEach(profile => {
      const row = renderFriendRow(profile);
      friendsList.appendChild(row);
    });
  } catch (err) {
    friendsList.innerHTML = `<div style="padding:20px; color:var(--status-dnd); text-align:center;">Error: ${err.message}</div>`;
  }
}

function renderFriendRow(profile) {
  const row = document.createElement('div');
  row.className = 'friend-row';
  
  const info = document.createElement('div');
  info.className = 'friend-info';
  
  const avatarContainer = document.createElement('div');
  avatarContainer.className = 'avatar-container';
  
  const avatar = document.createElement('img');
  avatar.className = 'user-avatar';
  avatar.src = profile.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
  
  const indicator = document.createElement('div');
  indicator.className = `status-indicator ${profile.status || 'offline'}`;
  
  avatarContainer.appendChild(avatar);
  avatarContainer.appendChild(indicator);
  
  const details = document.createElement('div');
  details.className = 'friend-details';
  
  const name = document.createElement('span');
  name.className = 'friend-name';
  name.textContent = profile.display_name || profile.username;
  
  const status = document.createElement('span');
  status.className = 'friend-status';
  status.textContent = profile.custom_status || (profile.status === 'offline' ? 'Desconectado' : profile.status === 'dnd' ? 'No molestar' : profile.status === 'idle' ? 'Ausente' : 'Conectado');
  
  details.appendChild(name);
  details.appendChild(status);
  
  info.appendChild(avatarContainer);
  info.appendChild(details);
  
  const actions = document.createElement('div');
  actions.className = 'friend-actions';
  
  // Message Button
  const msgBtn = document.createElement('button');
  msgBtn.className = 'friend-action-btn';
  msgBtn.setAttribute('data-tooltip', 'Enviar mensaje');
  msgBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>`;
  msgBtn.addEventListener('click', () => {
    startDMWithUser(profile.id, profile.username, profile.avatar_url);
  });
  
  actions.appendChild(msgBtn);
  
  row.appendChild(info);
  row.appendChild(actions);
  
  return row;
}

function renderDMsSidebar(profiles) {
  const scroller = document.getElementById('channel-list-scroller');
  if (!scroller) return;
  scroller.innerHTML = `<div class="channel-category-label">MENSAJES DIRECTOS</div>`;
  
  profiles.forEach(profile => {
    const link = document.createElement('div');
    link.className = 'channel-link';
    if (state.currentDMUserId === profile.id) {
      link.classList.add('active');
    }
    
    link.innerHTML = `
      <div class="avatar-container" style="width:24px; height:24px;">
        <img class="user-avatar" src="${profile.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:24px; height:24px;">
        <div class="status-indicator ${profile.status || 'offline'}" style="width:9px; height:9px; border-width:1.5px;"></div>
      </div>
      <span>${profile.display_name || profile.username}</span>
    `;
    
    link.addEventListener('click', () => {
      startDMWithUser(profile.id, profile.username, profile.avatar_url);
    });
    
    scroller.appendChild(link);
  });
}

function startDMWithUser(userId, username, avatarUrl) {
  state.currentGuildId = null;
  state.currentChannelId = null;
  state.currentDMUserId = userId;

  // Unsubscribe from channel feeds
  if (state.msgSub) state.msgSub.unsubscribe();
  state.msgSub = null;

  // Update layout displays
  document.getElementById('friends-view').classList.add('hidden');
  document.getElementById('friends-active-sidebar').classList.add('hidden');
  
  document.getElementById('messages-scroller').classList.remove('hidden');
  document.getElementById('message-input-area').classList.remove('hidden');
  document.getElementById('member-sidebar').classList.add('hidden'); // DMs don't have member sidebar

  // Highlight active DM
  renderDMsSidebar(state.allProfiles.filter(p => p.id !== state.currentUser.id));

  // Update Chat Header
  document.getElementById('chat-header-icon').innerHTML = `<path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>`;
  document.getElementById('chat-title').textContent = username;
  document.getElementById('chat-description').textContent = `Charlando con ${username}`;
  document.getElementById('btn-create-invite').classList.add('hidden');
  document.getElementById('btn-toggle-members').classList.add('hidden');

  // Input setup
  const inputField = document.getElementById('message-input');
  inputField.disabled = false;
  inputField.value = '';
  inputField.placeholder = `Enviar un mensaje a @${username}`;

  // Load message feed
  renderDMFeed();
}

function sendDM(content) {
  const userId = state.currentDMUserId;
  if (!userId) return;

  if (!state.dmMessages[userId]) {
    state.dmMessages[userId] = [];
  }

  // User message
  const userMsg = {
    id: Math.random().toString(),
    content: content,
    created_at: new Date().toISOString(),
    author_id: state.currentUser.id,
    profiles: state.userProfile
  };

  state.dmMessages[userId].push(userMsg);
  renderDMFeed();

  // Simulated reply
  setTimeout(() => {
    if (state.currentDMUserId !== userId) return; // check if view changed

    const replies = [
      "¡Hola! Estoy probando este clon de Discord. ¡Se ve genial! 🚀",
      "Sí, Supabase y Electron funcionan increíble en este proyecto.",
      "¡Qué gran diseño! Las transiciones son super fluidas.",
      "Oye, ¿viste que ahora podemos cambiar el estado directamente desde el footer? ¡Como en Discord real!",
      "¡Genial! Hablemos luego, voy a seguir explorando los servidores.",
      "Jajaja total, me encanta la estética.",
      "¡Hola! ¿Qué tal todo?",
      "¡Eso suena fantástico!"
    ];

    const randomReply = replies[Math.floor(Math.random() * replies.length)];
    const matchProfile = state.allProfiles.find(p => p.id === userId) || { username: 'Amigo' };

    const friendMsg = {
      id: Math.random().toString(),
      content: randomReply,
      created_at: new Date().toISOString(),
      author_id: userId,
      profiles: matchProfile
    };

    state.dmMessages[userId].push(friendMsg);
    renderDMFeed();
  }, 1000 + Math.random() * 1500);
}

function renderDMFeed() {
  const userId = state.currentDMUserId;
  const feed = document.getElementById('message-feed');
  if (!feed) return;
  feed.innerHTML = '';

  const messages = state.dmMessages[userId] || [];
  
  if (messages.length === 0) {
    const matchProfile = state.allProfiles.find(p => p.id === userId) || { username: 'Amigo' };
    feed.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; flex-grow:1; color:var(--text-muted); text-align:center; padding:40px; margin-top: 50px;">
        <img src="${matchProfile.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:80px; height:80px; border-radius:50%; margin-bottom:12px; border: 3px solid var(--border-color);">
        <h3 style="color:white; margin-bottom:8px; font-size: 24px;">${matchProfile.display_name || matchProfile.username}</h3>
        <p style="font-size: 15px; max-width: 320px;">Este es el principio de tu historia de mensajes directos con <strong>@${matchProfile.username}</strong>.</p>
      </div>
    `;
    return;
  }

  messages.forEach(msg => {
    const item = document.createElement('div');
    item.className = 'message-item';
    
    const avatar = document.createElement('img');
    avatar.className = 'message-avatar';
    avatar.src = msg.profiles?.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
    item.appendChild(avatar);

    const contentBox = document.createElement('div');
    contentBox.className = 'message-content-box';

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = msg.profiles?.display_name || msg.profiles?.username || 'Usuario';
    
    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    const date = new Date(msg.created_at);
    timestamp.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    meta.appendChild(author);
    meta.appendChild(timestamp);
    contentBox.appendChild(meta);

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = msg.content;
    contentBox.appendChild(text);

    item.appendChild(contentBox);
    feed.appendChild(item);
  });

  // Scroll to bottom
  const scroller = document.getElementById('messages-scroller');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

let currentEditingChannel = null;

function openCreateChannelModal(type) {
  showModal('channel-create-modal');
  
  const textRadio = document.getElementById('modal-channel-type-text');
  const voiceRadio = document.getElementById('modal-channel-type-voice');
  if (type === 'voice') {
    voiceRadio.checked = true;
    document.getElementById('channel-modal-prefix').textContent = '🔊';
  } else {
    textRadio.checked = true;
    document.getElementById('channel-modal-prefix').textContent = '#';
  }

  document.getElementById('modal-new-channel-name').value = '';
}

function openChannelSettings(channel) {
  currentEditingChannel = channel;
  showModal('channel-settings-modal');
  
  document.getElementById('modal-edit-channel-name').value = channel.name;
  document.getElementById('channel-edit-modal-prefix').textContent = channel.type === 'voice' ? '🔊' : '#';
}
