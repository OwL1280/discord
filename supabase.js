// Supabase client initialization and API wrappers wrapped in IIFE to isolate scope
(() => {
  // Bitwise Permission constants matching Discord
  const PERMISSIONS = {
    CREATE_INSTANT_INVITE: 1n,       // 1 << 0
    KICK_MEMBERS: 2n,                // 1 << 1
    ADMINISTRATOR: 8n,               // 1 << 3
    MANAGE_CHANNELS: 16n,            // 1 << 4
    MANAGE_GUILD: 32n,               // 1 << 5
    VIEW_CHANNEL: 1024n,             // 1 << 10
    SEND_MESSAGES: 2048n,            // 1 << 11
    MANAGE_MESSAGES: 8192n,          // 1 << 13
    MANAGE_ROLES: 268435456n         // 1 << 28
  };

  // Check if credentials are set
  const isConfigured = () => {
    const url = window.supabaseEnv.SUPABASE_URL;
    const key = window.supabaseEnv.SUPABASE_KEY;
    return url && key && !url.includes('your-supabase-project') && !key.includes('your-anon-key');
  };

  let supabase = null;
  if (isConfigured()) {
    supabase = window.supabase.createClient(
      window.supabaseEnv.SUPABASE_URL,
      window.supabaseEnv.SUPABASE_KEY
    );
  }

  // Authentication Helpers
  const signUp = async (email, password, username, displayName) => {
    if (!supabase) throw new Error('Supabase no está configurado. Edita el archivo .env');
    
    // Register the user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username,
          display_name: displayName || username
        }
      }
    });

    if (error) throw error;
    return data.user;
  };

  const signIn = async (email, password) => {
    if (!supabase) throw new Error('Supabase no está configurado. Edita el archivo .env');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data.user;
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const getCurrentUser = () => {
    if (!supabase) return null;
    return supabase.auth.getUser();
  };

  const setSession = async (accessToken, refreshToken) => {
    if (!supabase) throw new Error('Supabase no está configurado. Edita el archivo .env');
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (error) throw error;
    return data.user;
  };

  const getUserProfile = async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  };

  const updateUserProfile = async (profileUpdates) => {
    const userResp = await supabase.auth.getUser();
    const userId = userResp.data.user.id;
    
    const { data, error } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const getProfiles = async () => {
    if (!supabase) throw new Error('Supabase no está configurado. Edita el archivo .env');
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('username', { ascending: true });
    if (error) throw error;
    return data;
  };

  // Guild (Server) Helpers
  const getGuilds = async () => {
    const { data, error } = await supabase
      .from('guilds')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  };

  const createGuild = async (guildName) => {
    const { data, error } = await supabase
      .rpc('create_guild', { guild_name: guildName });
    if (error) throw error;
    return data; // returns { guild_id, everyone_role_id, general_channel_id }
  };

  const deleteGuild = async (guildId) => {
    const { error } = await supabase
      .from('guilds')
      .delete()
      .eq('id', guildId);
    if (error) throw error;
  };

  const updateGuildOverview = async (guildId, name, iconUrl) => {
    const { data, error } = await supabase
      .from('guilds')
      .update({ name, icon_url: iconUrl })
      .eq('id', guildId)
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const getGuildMembers = async (guildId) => {
    const { data, error } = await supabase
      .from('members')
      .select(`
        user_id,
        nickname,
        joined_at,
        profiles:user_id (*)
      `)
      .eq('guild_id', guildId);
    if (error) throw error;
    return data;
  };

  const kickMember = async (guildId, userId) => {
    const { error } = await supabase
      .from('members')
      .delete()
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    if (error) throw error;
  };

  // Channel Helpers
  const getGuildChannels = async (guildId) => {
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('guild_id', guildId)
      .order('position', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return data;
  };

  const createChannel = async (guildId, name, type) => {
    const { data, error } = await supabase
      .from('channels')
      .insert({ guild_id: guildId, name: name.toLowerCase(), type: type })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const updateChannel = async (channelId, name) => {
    const { data, error } = await supabase
      .from('channels')
      .update({ name: name.toLowerCase() })
      .eq('id', channelId)
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const deleteChannel = async (channelId) => {
    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('id', channelId);
    if (error) throw error;
  };

  // Role Helpers
  const getGuildRoles = async (guildId) => {
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .eq('guild_id', guildId)
      .order('position', { ascending: true });
    if (error) throw error;
    return data;
  };

  const getMemberRoles = async (guildId) => {
    const { data, error } = await supabase
      .from('member_roles')
      .select('*')
      .eq('guild_id', guildId);
    if (error) throw error;
    return data;
  };

  const createRole = async (guildId, name, color, permissions) => {
    const { data, error } = await supabase
      .from('roles')
      .insert({ guild_id: guildId, name, color, permissions: Number(permissions) })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const updateRole = async (roleId, name, color, permissions) => {
    const { data, error } = await supabase
      .from('roles')
      .update({ name, color, permissions: Number(permissions) })
      .eq('id', roleId)
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const deleteRole = async (roleId) => {
    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('id', roleId);
    if (error) throw error;
  };

  const assignRoleToMember = async (guildId, userId, roleId) => {
    const { data, error } = await supabase
      .from('member_roles')
      .insert({ guild_id: guildId, user_id: userId, role_id: roleId })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const removeRoleFromMember = async (guildId, userId, roleId) => {
    const { error } = await supabase
      .from('member_roles')
      .delete()
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('role_id', roleId);
    if (error) throw error;
  };

  // Message Helpers
  const getMessages = async (channelId) => {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        id,
        content,
        created_at,
        author_id,
        profiles:author_id (*)
      `)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  };

  const sendMessage = async (channelId, content) => {
    const userResp = await supabase.auth.getUser();
    const authorId = userResp.data.user.id;
    
    const { data, error } = await supabase
      .from('messages')
      .insert({ channel_id: channelId, author_id: authorId, content })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const deleteMessage = async (messageId) => {
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);
    if (error) throw error;
  };

  const editMessage = async (messageId, content) => {
    const { data, error } = await supabase
      .from('messages')
      .update({ content })
      .eq('id', messageId)
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  // Invite Helpers
  const createInvite = async (guildId, channelId, maxUses, durationSeconds) => {
    const userResp = await supabase.auth.getUser();
    const inviterId = userResp.data.user.id;
    
    // Generate a random 8-character code
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    let expiresAt = null;
    if (durationSeconds && durationSeconds !== 'never') {
      expiresAt = new Date(Date.now() + Number(durationSeconds) * 1000).toISOString();
    }

    const { data, error } = await supabase
      .from('invites')
      .insert({
        code,
        guild_id: guildId,
        channel_id: channelId,
        inviter_id: inviterId,
        max_uses: maxUses === 0 ? null : maxUses,
        expires_at: expiresAt,
        uses: 0
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const joinGuildByInvite = async (inviteCode) => {
    const { data, error } = await supabase
      .rpc('join_guild', { invite_code: inviteCode });
    if (error) throw error;
    return data; // returns { guild_id, message }
  };

  // Permissions Engine (Client Side Calculator)
  const calculatePermissions = async (guildId, userId) => {
    // Get Guild details
    const { data: guild, error: gErr } = await supabase
      .from('guilds')
      .select('owner_id')
      .eq('id', guildId)
      .single();
    if (gErr) return 0n;

    // Owner has ALL permissions
    if (guild.owner_id === userId) {
      // Return max bigint representation representing full rights
      return ~0n; 
    }

    // Fetch roles
    const { data: roles, error: rErr } = await supabase
      .from('roles')
      .select('*')
      .eq('guild_id', guildId);
    if (rErr) return 0n;

    // Fetch user roles
    const { data: userRoles, error: urErr } = await supabase
      .from('member_roles')
      .select('role_id')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    if (urErr) return 0n;

    const userRoleIds = new Set(userRoles.map(ur => ur.role_id));

    // Bitwise OR of all matching roles plus @everyone
    let permissionsBit = 0n;
    for (const role of roles) {
      if (role.name === '@everyone' || userRoleIds.has(role.id)) {
        permissionsBit |= BigInt(role.permissions);
      }
    }

    return permissionsBit;
  };

  const checkUserPermission = async (guildId, userId, reqPermBit) => {
    const userPerms = await calculatePermissions(guildId, userId);
    // Admin bit (8) bypasses check
    if ((userPerms & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
      return true;
    }
    return (userPerms & reqPermBit) === reqPermBit;
  };

  // Realtime listeners wrappers
  const subscribeToMessages = (channelId, onInsert, onDelete, onUpdate) => {
    return supabase
      .channel(`messages:${channelId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`
      }, async (payload) => {
        // Fetch profile details for new messages
        try {
          const profile = await getUserProfile(payload.new.author_id);
          payload.new.profiles = profile;
          onInsert(payload.new);
        } catch (err) {
          console.error('Failed to fetch author profile for realtime message', err);
          onInsert(payload.new);
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`
      }, (payload) => {
        onDelete(payload.old.id);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`
      }, (payload) => {
        onUpdate(payload.new);
      })
      .subscribe();
  };

  const subscribeToGuildMembers = (guildId, onChange) => {
    return supabase
      .channel(`guild-members:${guildId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'members',
        filter: `guild_id=eq.${guildId}`
      }, () => {
        onChange();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'member_roles',
        filter: `guild_id=eq.${guildId}`
      }, () => {
        onChange();
      })
      .subscribe();
  };

  const subscribeToProfiles = (onChange) => {
    return supabase
      .channel('public-profiles')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        onChange(payload.new);
      })
      .subscribe();
  };

  // Expose APIs
  window.api = {
    supabase,
    isConfigured,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    setSession,
    getUserProfile,
    updateUserProfile,
    getProfiles,
    
    getGuilds,
    createGuild,
    deleteGuild,
    updateGuildOverview,
    getGuildMembers,
    kickMember,
    
    getGuildChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    
    getGuildRoles,
    getMemberRoles,
    createRole,
    updateRole,
    deleteRole,
    assignRoleToMember,
    removeRoleFromMember,
    
    getMessages,
    sendMessage,
    deleteMessage,
    editMessage,
    
    createInvite,
    joinGuildByInvite,
    
    PERMISSIONS,
    calculatePermissions,
    checkUserPermission,
    
    subscribeToMessages,
    subscribeToGuildMembers,
    subscribeToProfiles
  };
})();
