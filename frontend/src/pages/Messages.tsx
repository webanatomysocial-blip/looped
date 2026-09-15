import { useEffect, useState, useRef } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { Send, MessageCircle, Plus, Users, User as UserIcon, Paperclip, UserPlus, X, Search, Check, CheckCheck } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import { messagesApi, projectsApi, internalChatApi, usersApi } from '../services/api';
import { Message, Project, InternalChat, InternalMessage, User } from '../types';
import '../css/pages/Messages.css';

type Tab = 'internal' | 'client';

function formatMsgDate(d: string | Date) {
  const dt = new Date(d);
  if (isToday(dt)) return format(dt, 'h:mm a');
  if (isYesterday(dt)) return 'Yesterday';
  return format(dt, 'dd/MM/yy');
}

function dateDivider(d: string | Date) {
  const dt = new Date(d);
  if (isToday(dt)) return 'Today';
  if (isYesterday(dt)) return 'Yesterday';
  return format(dt, 'MMMM d, yyyy');
}

function WaAvatar({ name, color, avatarUrl, size = 46 }: { name: string; color?: string; avatarUrl?: string | null; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const bg = color || '#00a884';
  return (
    <div className="wa-avatar" style={{ width: size, height: size, background: avatarUrl ? undefined : bg, fontSize: size * 0.37 }}>
      {avatarUrl ? <img src={avatarUrl} alt={name} /> : initials}
    </div>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const isClient = user?.role === 'client';
  const [tab, setTab] = useState<Tab>(isClient ? 'client' : 'internal');
  const [search, setSearch] = useState('');

  // Internal chat state
  const [chats, setChats] = useState<InternalChat[]>([]);
  const [activeChat, setActiveChat] = useState<InternalChat | null>(null);
  const [internalMsgs, setInternalMsgs] = useState<InternalMessage[]>([]);
  const [internalText, setInternalText] = useState('');
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatType, setNewChatType] = useState<'direct' | 'group'>('direct');
  const [newChatName, setNewChatName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<number[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Client chat state
  const [clientMsgs, setClientMsgs] = useState<Message[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [clientText, setClientText] = useState('');
  const clientFileRef = useRef<HTMLInputElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [internalMsgs, clientMsgs]);

  useEffect(() => {
    if (isClient) return;
    internalChatApi.listChats().then(r => setChats(r.data));
    usersApi.team().then(r => setTeamUsers(r.data.filter((u: User) => u.id !== user?.id)));
  }, []);

  useEffect(() => {
    if (!activeChat) return;
    const load = () => internalChatApi.getMessages(activeChat.id).then(r => setInternalMsgs(r.data));
    load();
    messagesApi.markRead({ chat_id: activeChat.id }).catch(() => {});
    const iv = setInterval(() => { load(); messagesApi.markRead({ chat_id: activeChat.id }).catch(() => {}); }, 5000);
    return () => clearInterval(iv);
  }, [activeChat]);

  useEffect(() => {
    projectsApi.list().then(r => {
      const list: Project[] = r.data;
      setProjects(list);
      if (list.length > 0 && !selectedProject) setSelectedProject(list[0]);
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    const load = () => messagesApi.list(selectedProject.id).then(r => setClientMsgs(r.data));
    load();
    messagesApi.markRead({ project_id: selectedProject.id }).catch(() => {});
    const iv = setInterval(() => { load(); messagesApi.markRead({ project_id: selectedProject.id }).catch(() => {}); }, 4000);
    return () => clearInterval(iv);
  }, [selectedProject]);

  const sendInternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalText.trim() || !activeChat) return;
    await internalChatApi.sendMessage(activeChat.id, internalText);
    setInternalText('');
    internalChatApi.getMessages(activeChat.id).then(r => setInternalMsgs(r.data));
  };

  const sendClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientText.trim() || !selectedProject) return;
    await messagesApi.send(clientText, selectedProject.id);
    setClientText('');
    messagesApi.list(selectedProject.id).then(r => setClientMsgs(r.data));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !activeChat) return;
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    await internalChatApi.uploadFile(activeChat.id, fd);
    internalChatApi.getMessages(activeChat.id).then(r => setInternalMsgs(r.data));
    e.target.value = '';
  };

  const handleClientFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedProject) return;
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    await messagesApi.uploadFile(selectedProject.id, fd);
    messagesApi.list(selectedProject.id).then(r => setClientMsgs(r.data));
    e.target.value = '';
  };

  const addMembersToGroup = async () => {
    if (!activeChat || !addMemberIds.length) return;
    await Promise.all(addMemberIds.map(uid => internalChatApi.addMember(activeChat.id, uid)));
    const refreshed = await internalChatApi.listChats();
    setChats(refreshed.data);
    const found = refreshed.data.find((c: InternalChat) => c.id === activeChat.id);
    if (found) setActiveChat(found);
    setShowAddMember(false); setAddMemberIds([]);
  };

  const createChat = async () => {
    if (!selectedMembers.length) return;
    const r = await internalChatApi.createChat({ type: newChatType, name: newChatType === 'group' ? newChatName : undefined, member_ids: selectedMembers });
    const newId = r.data.id;
    const refreshed = await internalChatApi.listChats();
    setChats(refreshed.data);
    const found = refreshed.data.find((c: InternalChat) => c.id === newId);
    if (found) setActiveChat(found);
    setShowNewChat(false); setSelectedMembers([]); setNewChatName('');
  };

  const getChatLabel = (chat: InternalChat) => {
    if (chat.type === 'group') return chat.name || 'Group Chat';
    const other = chat.members.find(m => m.id !== user?.id);
    return other?.name || 'Chat';
  };

  const getChatOther = (chat: InternalChat) => chat.type === 'direct' ? chat.members.find(m => m.id !== user?.id) : null;

  const toggleMember = (id: number) => setSelectedMembers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const allSelected = teamUsers.length > 0 && teamUsers.every(u => selectedMembers.includes(u.id));
  const toggleAll = () => allSelected ? setSelectedMembers([]) : setSelectedMembers(teamUsers.map(u => u.id));
  const nonMembers = teamUsers.filter(u => !activeChat?.members.some(m => m.id === u.id));

  const saveRename = async () => {
    if (!activeChat || !renameVal.trim()) return;
    await internalChatApi.renameChat(activeChat.id, renameVal.trim());
    const refreshed = await internalChatApi.listChats();
    setChats(refreshed.data);
    const found = refreshed.data.find((c: InternalChat) => c.id === activeChat.id);
    if (found) setActiveChat(found);
    setEditingName(false);
  };

  // Inject date dividers into message list
  function withDividers<T extends { created_at: string }>(msgs: T[]) {
    const out: Array<T | { __divider: string; created_at: string }> = [];
    let last = '';
    for (const m of msgs) {
      const label = dateDivider(m.created_at);
      if (label !== last) { out.push({ __divider: label, created_at: m.created_at }); last = label; }
      out.push(m);
    }
    return out;
  }

  const filteredChats = chats.filter(c => getChatLabel(c).toLowerCase().includes(search.toLowerCase()));
  const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  // Determine active tab's current conversation label + members for header
  const headerName = tab === 'internal'
    ? (activeChat ? getChatLabel(activeChat) : '')
    : (selectedProject?.name ?? '');
  const headerSub = tab === 'internal'
    ? (activeChat ? activeChat.members.map(m => m.name).join(', ') : '')
    : (selectedProject ? [selectedProject.client_name, ...selectedProject.members.map(m => m.name)].filter(Boolean).join(', ') : '');
  const headerAvatar = tab === 'internal' && activeChat
    ? (activeChat.type === 'direct' ? getChatOther(activeChat) : null)
    : null;

  const renderBubbles = (msgs: any[], isInternalMsgs: boolean) => {
    const items = withDividers(msgs);
    return items.map((item, idx) => {
      if ('__divider' in item) {
        return (
          <div key={`div-${idx}`} className="wa-date-divider">
            <span>{item.__divider}</span>
          </div>
        );
      }
      const m = item as any;
      const isMe = m.sender_id === user?.id;
      const content = isInternalMsgs ? m.content : m.message;
      const fileUrl = m.file_url;
      const fileName = m.file_name;
      const senderName = m.sender_name;
      return (
        <div key={m.id} className={`wa-bubble-wrap wa-bubble-wrap--${isMe ? 'mine' : 'theirs'}`}>
          {!isMe && <p className="wa-sender-name">{senderName?.split(' ')[0]}</p>}
          {fileUrl ? (
            <a href={fileUrl} target="_blank" rel="noreferrer" className={`wa-bubble wa-bubble--file wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
              <Paperclip size={12} /> {fileName || content}
            </a>
          ) : (
            <div className={`wa-bubble wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
              {content}
              <div className="wa-bubble-footer">
                <span className="wa-time">{format(new Date(m.created_at), 'h:mm a')}</span>
                {isMe && <span className="wa-tick"><CheckCheck size={14} /></span>}
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <Layout>
      <div style={{ padding: '0 0 0 0' }}>
        <div className="wa-wrap">

          {/* ── SIDEBAR ─────────────────────────────── */}
          <div className="wa-sidebar">
            <div className="wa-sidebar-header">
              <p className="wa-sidebar-title">Messages</p>
              <div className="wa-sidebar-actions">
                {!isClient && (
                  <button className="wa-icon-btn" title="New chat" onClick={() => setShowNewChat(v => !v)}>
                    {showNewChat ? <X size={18} /> : <Plus size={18} />}
                  </button>
                )}
              </div>
            </div>

            {/* Tab bar */}
            {!isClient && (
              <div className="wa-tabs">
                <button className={`wa-tab${tab === 'internal' ? ' wa-tab--active' : ''}`} onClick={() => setTab('internal')}>Team</button>
                <button className={`wa-tab${tab === 'client' ? ' wa-tab--active' : ''}`} onClick={() => setTab('client')}>Clients</button>
              </div>
            )}

            {/* Search */}
            <div className="wa-search-wrap">
              <div className="wa-search">
                <Search size={14} />
                <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            {/* New chat panel */}
            {showNewChat && !isClient && (
              <div className="wa-new-panel">
                <div className="wa-new-type-row">
                  <button className={`wa-type-btn${newChatType === 'direct' ? ' selected' : ''}`} onClick={() => setNewChatType('direct')}><UserIcon size={12} /> Direct</button>
                  <button className={`wa-type-btn${newChatType === 'group' ? ' selected' : ''}`} onClick={() => setNewChatType('group')}><Users size={12} /> Group</button>
                </div>
                {newChatType === 'group' && (
                  <input className="wa-new-input" placeholder="Group name…" value={newChatName} onChange={e => setNewChatName(e.target.value)} />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button style={{ fontSize: 11, color: '#00a884', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '2px 4px' }} onClick={toggleAll}>
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="wa-member-list">
                  {teamUsers.map(u => (
                    <div key={u.id} className={`wa-member-row${selectedMembers.includes(u.id) ? ' selected' : ''}`} onClick={() => toggleMember(u.id)}>
                      <div className="wa-member-check">{selectedMembers.includes(u.id) && <Check size={11} color="#fff" />}</div>
                      <WaAvatar name={u.name} color={u.avatar_color} avatarUrl={u.avatar_url} size={30} />
                      <span className="wa-member-name">{u.name}</span>
                      <span className="wa-member-role">{u.role}</span>
                    </div>
                  ))}
                </div>
                <button className="wa-start-btn" onClick={createChat} disabled={!selectedMembers.length}>Start Chat</button>
              </div>
            )}

            {/* Chat list */}
            <div className="wa-chat-list">
              {tab === 'internal' && !isClient && (
                filteredChats.length === 0
                  ? <p className="wa-no-chats">No conversations yet</p>
                  : filteredChats.map(chat => {
                      const other = getChatOther(chat);
                      const last = chat.last_message;
                      return (
                        <div key={chat.id} className={`wa-chat-item${activeChat?.id === chat.id ? ' wa-chat-item--active' : ''}`} onClick={() => setActiveChat(chat)}>
                          {chat.type === 'direct' && other
                            ? <WaAvatar name={other.name} color={other.avatar_color} avatarUrl={(other as any).avatar_url} />
                            : <div className="wa-avatar wa-avatar--group"><Users size={20} /></div>}
                          <div className="wa-chat-info">
                            <p className="wa-chat-name">{getChatLabel(chat)}</p>
                            <p className="wa-chat-preview">{last ? last.content.slice(0, 35) + (last.content.length > 35 ? '…' : '') : 'No messages yet'}</p>
                          </div>
                          {last && <div className="wa-chat-meta"><span className="wa-chat-time">{formatMsgDate(last.created_at)}</span></div>}
                        </div>
                      );
                    })
              )}
              {(tab === 'client' || isClient) && (
                filteredProjects.length === 0
                  ? <p className="wa-no-chats">No projects yet</p>
                  : filteredProjects.map(p => (
                      <div key={p.id} className={`wa-chat-item${selectedProject?.id === p.id ? ' wa-chat-item--active' : ''}`} onClick={() => setSelectedProject(p)}>
                        <div className="wa-avatar" style={{ background: '#5b8dee', fontSize: 16, fontWeight: 700, color: '#fff' }}>
                          {p.name[0]?.toUpperCase()}
                        </div>
                        <div className="wa-chat-info">
                          <p className="wa-chat-name">{p.name}</p>
                          <p className="wa-chat-preview">{p.client_name || 'No client'}</p>
                        </div>
                      </div>
                    ))
              )}
            </div>
          </div>

          {/* ── CHAT PANEL ──────────────────────────── */}
          <div className="wa-chat-panel">
            {/* No conversation selected */}
            {((tab === 'internal' && !activeChat) || (tab === 'client' && !selectedProject)) && (
              <div className="wa-empty-state">
                <div className="wa-empty-icon"><MessageCircle size={36} color="#00a884" /></div>
                <p>{tab === 'internal' ? 'Select a conversation to start chatting' : 'Select a project to view messages'}</p>
              </div>
            )}

            {/* Active conversation */}
            {((tab === 'internal' && activeChat) || ((tab === 'client' || isClient) && selectedProject)) && (
              <>
                {/* Header */}
                <div className="wa-chat-header">
                  {headerAvatar
                    ? <WaAvatar name={headerAvatar.name} color={headerAvatar.avatar_color} avatarUrl={(headerAvatar as any).avatar_url} />
                    : <div className="wa-avatar" style={{ background: tab === 'client' ? '#5b8dee' : '#00a884', fontSize: 17, fontWeight: 700, color: '#fff' }}>
                        {headerName[0]?.toUpperCase()}
                      </div>}
                  <div className="wa-chat-header-info">
                    {tab === 'internal' && activeChat?.type === 'group' && editingName
                      ? <input
                          autoFocus
                          className="wa-new-input"
                          style={{ padding: '4px 8px', fontSize: 14, fontWeight: 700, width: '100%' }}
                          value={renameVal}
                          onChange={e => setRenameVal(e.target.value)}
                          onBlur={saveRename}
                          onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingName(false); }}
                        />
                      : <p
                          className="wa-chat-header-name"
                          style={tab === 'internal' && activeChat?.type === 'group' ? { cursor: 'pointer' } : undefined}
                          title={tab === 'internal' && activeChat?.type === 'group' ? 'Click to rename' : undefined}
                          onClick={() => {
                            if (tab === 'internal' && activeChat?.type === 'group') {
                              setRenameVal(getChatLabel(activeChat));
                              setEditingName(true);
                            }
                          }}
                        >{headerName}</p>
                    }
                    <p className="wa-chat-header-sub">{headerSub}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {tab === 'internal' && activeChat?.type === 'group' && (
                      <button className="wa-icon-btn" title="Add member" onClick={() => { setShowAddMember(v => !v); setAddMemberIds([]); }}>
                        {showAddMember ? <X size={18} /> : <UserPlus size={18} />}
                      </button>
                    )}
                    {tab === 'internal' && (
                      <button className="wa-icon-btn" title="Attach file" onClick={() => fileInputRef.current?.click()}>
                        <Paperclip size={18} />
                      </button>
                    )}
                    {(tab === 'client' || isClient) && (
                      <button className="wa-icon-btn" title="Attach file" onClick={() => clientFileRef.current?.click()}>
                        <Paperclip size={18} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Add member panel */}
                {showAddMember && tab === 'internal' && activeChat?.type === 'group' && (
                  <div className="wa-add-member-panel">
                    <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>Add members</p>
                    {nonMembers.length === 0
                      ? <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Everyone is already in this group.</p>
                      : <>
                          <div className="wa-member-list" style={{ maxHeight: 120 }}>
                            {nonMembers.map(u => (
                              <div key={u.id} className={`wa-member-row${addMemberIds.includes(u.id) ? ' selected' : ''}`}
                                onClick={() => setAddMemberIds(prev => prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id])}>
                                <div className="wa-member-check">{addMemberIds.includes(u.id) && <Check size={11} color="#fff" />}</div>
                                <WaAvatar name={u.name} color={u.avatar_color} avatarUrl={u.avatar_url} size={28} />
                                <span className="wa-member-name">{u.name}</span>
                              </div>
                            ))}
                          </div>
                          <button className="wa-start-btn" style={{ marginTop: 8 }} onClick={addMembersToGroup} disabled={!addMemberIds.length}>Add to group</button>
                        </>}
                  </div>
                )}

                {/* Messages */}
                <div className="wa-body">
                  {tab === 'internal' && activeChat && (
                    internalMsgs.length === 0
                      ? <div className="wa-empty-state" style={{ flex: 'unset', marginTop: 40 }}><p>No messages yet — say hello! 👋</p></div>
                      : renderBubbles(internalMsgs, true)
                  )}
                  {(tab === 'client' || isClient) && selectedProject && (
                    clientMsgs.length === 0
                      ? <div className="wa-empty-state" style={{ flex: 'unset', marginTop: 40 }}><p>No messages yet — say hello! 👋</p></div>
                      : renderBubbles(clientMsgs, false)
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input bar */}
                <form
                  onSubmit={tab === 'internal' ? sendInternal : sendClient}
                  className="wa-input-bar"
                >
                  <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                  <input type="file" ref={clientFileRef} style={{ display: 'none' }} onChange={handleClientFileUpload} />
                  <input
                    className="wa-input"
                    placeholder="Type a message"
                    value={tab === 'internal' ? internalText : clientText}
                    onChange={e => tab === 'internal' ? setInternalText(e.target.value) : setClientText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (tab === 'internal' ? sendInternal(e as any) : sendClient(e as any))}
                  />
                  <button type="submit" className="wa-send-btn" disabled={tab === 'internal' ? !internalText.trim() : !clientText.trim()}>
                    <Send size={18} />
                  </button>
                </form>
              </>
            )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
