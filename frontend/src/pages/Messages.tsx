import { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import { Send, MessageCircle, Plus, Users, User as UserIcon, Paperclip, UserPlus, X } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import { messagesApi, projectsApi, internalChatApi, usersApi } from '../services/api';
import { Message, Project, InternalChat, InternalMessage, User } from '../types';
import '../css/pages/Messages.css';

type Tab = 'internal' | 'client';

export default function Messages() {
  const { user } = useAuth();
  const isClient = user?.role === 'client';
  const [tab, setTab] = useState<Tab>(isClient ? 'client' : 'internal');

  // --- Internal chat state ---
  const [chats, setChats] = useState<InternalChat[]>([]);
  const [activeChat, setActiveChat] = useState<InternalChat | null>(null);
  const [internalMsgs, setInternalMsgs] = useState<InternalMessage[]>([]);
  const [internalText, setInternalText] = useState('');
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatType, setNewChatType] = useState<'direct' | 'group'>('direct');
  const [newChatName, setNewChatName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientFileInputRef = useRef<HTMLInputElement>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<number[]>([]);

  // --- Client chat state ---
  const [clientMsgs, setClientMsgs] = useState<Message[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [clientText, setClientText] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [internalMsgs, clientMsgs]);

  // Load internal chats + team users
  useEffect(() => {
    if (isClient) return;
    internalChatApi.listChats().then((r) => setChats(r.data));
    usersApi.team().then((r) => setTeamUsers(r.data.filter((u: User) => u.id !== user?.id)));
  }, []);

  // Load messages when activeChat changes
  useEffect(() => {
    if (!activeChat) return;
    internalChatApi.getMessages(activeChat.id).then((r) => setInternalMsgs(r.data));
    const interval = setInterval(() => {
      internalChatApi.getMessages(activeChat.id).then((r) => setInternalMsgs(r.data));
    }, 5000);
    return () => clearInterval(interval);
  }, [activeChat]);

  // Load projects, then auto-select first project
  useEffect(() => {
    projectsApi.list().then((r) => {
      const list: Project[] = r.data;
      setProjects(list);
      if (list.length > 0 && !selectedProject) setSelectedProject(list[0]);
    });
  }, []);

  // Load + auto-refresh client messages whenever project changes
  useEffect(() => {
    if (!selectedProject) return;
    const fetch = () => messagesApi.list(selectedProject.id).then((r) => setClientMsgs(r.data));
    fetch();
    const interval = setInterval(fetch, 4000);
    return () => clearInterval(interval);
  }, [selectedProject]);

  const sendInternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalText.trim() || !activeChat) return;
    await internalChatApi.sendMessage(activeChat.id, internalText);
    setInternalText('');
    internalChatApi.getMessages(activeChat.id).then((r) => setInternalMsgs(r.data));
  };

  const sendClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientText.trim() || !selectedProject) return;
    await messagesApi.send(clientText, selectedProject.id);
    setClientText('');
    messagesApi.list(selectedProject.id).then((r) => setClientMsgs(r.data));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !activeChat) return;
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    await internalChatApi.uploadFile(activeChat.id, fd);
    internalChatApi.getMessages(activeChat.id).then((r) => setInternalMsgs(r.data));
    e.target.value = '';
  };

  const handleClientFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedProject) return;
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    await messagesApi.uploadFile(selectedProject.id, fd);
    messagesApi.list(selectedProject.id).then((r) => setClientMsgs(r.data));
    e.target.value = '';
  };

  const addMembersToGroup = async () => {
    if (!activeChat || !addMemberIds.length) return;
    await Promise.all(addMemberIds.map((uid) => internalChatApi.addMember(activeChat.id, uid)));
    const refreshed = await internalChatApi.listChats();
    setChats(refreshed.data);
    const found = refreshed.data.find((c: InternalChat) => c.id === activeChat.id);
    if (found) setActiveChat(found);
    setShowAddMember(false);
    setAddMemberIds([]);
  };

  const nonMembers = teamUsers.filter((u) => !activeChat?.members.some((m) => m.id === u.id));

  const createChat = async () => {
    if (!selectedMembers.length) return;
    const r = await internalChatApi.createChat({
      type: newChatType,
      name: newChatType === 'group' ? newChatName : undefined,
      member_ids: selectedMembers,
    });
    const newId = r.data.id;
    const refreshed = await internalChatApi.listChats();
    setChats(refreshed.data);
    const found = refreshed.data.find((c: InternalChat) => c.id === newId);
    if (found) setActiveChat(found);
    setShowNewChat(false);
    setSelectedMembers([]);
    setNewChatName('');
  };

  const getChatLabel = (chat: InternalChat) => {
    if (chat.type === 'group') return chat.name || 'Group Chat';
    const other = chat.members.find((m) => m.id !== user?.id);
    return other?.name || 'Chat';
  };

  const toggleMember = (id: number) =>
    setSelectedMembers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const selectAll = () => setSelectedMembers(teamUsers.map((u) => u.id));
  const clearAll  = () => setSelectedMembers([]);
  const allSelected = teamUsers.length > 0 && teamUsers.every((u) => selectedMembers.includes(u.id));

  return (
    <Layout>
      <div className="page-wrap">
        
        <h2 className="page-title" style={{ marginBottom: 16 }}>Messages</h2>

        {/* Tab switcher */}
        {!isClient && (
          <div className="msg-tabs">
            <button className={`msg-tab${tab === 'internal' ? ' msg-tab--active' : ''}`} onClick={() => setTab('internal')}>
              Internal Chat
            </button>
            <button className={`msg-tab${tab === 'client' ? ' msg-tab--active' : ''}`} onClick={() => setTab('client')}>
              Client Chat
            </button>
          </div>
        )}

        {/* ── INTERNAL CHAT ── */}
        {tab === 'internal' && !isClient && (
          <div className="messages-layout">
            {/* Chat list */}
            <div className="msg-projects-panel">
              <div className="msg-projects-panel__header">
                <p className="msg-projects-panel__title">Conversations</p>
                <button className="msg-new-btn" onClick={() => setShowNewChat(!showNewChat)} title="New chat">
                  <Plus size={14} />
                </button>
              </div>

              {/* New chat form */}
              {showNewChat && (
                <div className="msg-new-form">
                  <div className="msg-new-type-row">
                    <button className={`msg-type-btn${newChatType === 'direct' ? ' selected' : ''}`} onClick={() => setNewChatType('direct')}>
                      <UserIcon size={12} /> Direct
                    </button>
                    <button className={`msg-type-btn${newChatType === 'group' ? ' selected' : ''}`} onClick={() => setNewChatType('group')}>
                      <Users size={12} /> Group
                    </button>
                  </div>
                  {newChatType === 'group' && (
                    <input
                      className="msg-new-name-input"
                      placeholder="Group name…"
                      value={newChatName}
                      onChange={(e) => setNewChatName(e.target.value)}
                    />
                  )}
                  <div className="msg-select-all-row">
                    <button type="button" className="msg-select-all-btn" onClick={allSelected ? clearAll : selectAll}>
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                    {selectedMembers.length > 0 && (
                      <span className="msg-selected-count">{selectedMembers.length} selected</span>
                    )}
                  </div>
                  <div className="msg-member-select">
                    {teamUsers.map((u) => (
                      <div
                        key={u.id}
                        className={`msg-member-row${selectedMembers.includes(u.id) ? ' selected' : ''}`}
                        onClick={() => toggleMember(u.id)}
                      >
                        <div className="msg-member-dot" style={{ background: u.avatar_color }} />
                        <span className="msg-member-name">{u.name}</span>
                        <span className="msg-member-role">{u.role}</span>
                      </div>
                    ))}
                  </div>
                  <button className="msg-create-btn" onClick={createChat} disabled={!selectedMembers.length}>
                    Start Chat
                  </button>
                </div>
              )}

              <div className="msg-project-list">
                {chats.length === 0 && !showNewChat && (
                  <p className="msg-no-chats">No conversations yet. Start one!</p>
                )}
                {chats.map((chat) => {
                  const other = chat.type === 'direct' ? chat.members.find((m) => m.id !== user?.id) : null;
                  return (
                    <div
                      key={chat.id}
                      className={`msg-project-item${activeChat?.id === chat.id ? ' msg-project-item--active' : ''}`}
                      onClick={() => setActiveChat(chat)}
                    >
                      <div className="msg-chat-item-row">
                        {chat.type === 'direct' && other ? (
                          <span className="msg-avatar-dot" style={{ background: other.avatar_color }} />
                        ) : (
                          <span className="msg-group-icon"><Users size={12} /></span>
                        )}
                        <div>
                          <p className="msg-project-item__name">{getChatLabel(chat)}</p>
                          {chat.last_message && (
                            <p className="msg-project-item__client">
                              {chat.last_message.content.slice(0, 30)}{chat.last_message.content.length > 30 ? '…' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chat area */}
            <div className="msg-chat-panel">
              {!activeChat ? (
                <div className="msg-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <MessageCircle size={36} style={{ opacity: 0.2 }} />
                  <p>Select a conversation or start a new one</p>
                </div>
              ) : (
                <>
                  <div className="msg-chat-header">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="msg-chat-header__name">{getChatLabel(activeChat)}</p>
                      <p className="msg-chat-header__sub">{activeChat.members.map((m) => m.name).join(', ')}</p>
                    </div>
                    {activeChat.type === 'group' && (
                      <button
                        className="msg-new-btn"
                        title="Add member"
                        onClick={() => { setShowAddMember((v) => !v); setAddMemberIds([]); }}
                        style={{ marginLeft: 8, flexShrink: 0 }}
                      >
                        {showAddMember ? <X size={14} /> : <UserPlus size={14} />}
                      </button>
                    )}
                  </div>

                  {showAddMember && activeChat.type === 'group' && (
                    <div className="msg-new-form" style={{ borderBottom: '1px solid var(--border)', borderRadius: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Add members</p>
                      {nonMembers.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Everyone is already in this group.</p>
                      ) : (
                        <>
                          <div className="msg-member-select">
                            {nonMembers.map((u) => (
                              <div
                                key={u.id}
                                className={`msg-member-row${addMemberIds.includes(u.id) ? ' selected' : ''}`}
                                onClick={() => setAddMemberIds((prev) => prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                              >
                                <div className="msg-member-dot" style={{ background: u.avatar_color }} />
                                <span className="msg-member-name">{u.name}</span>
                                <span className="msg-member-role">{u.role}</span>
                              </div>
                            ))}
                          </div>
                          <button className="msg-create-btn" onClick={addMembersToGroup} disabled={!addMemberIds.length}>
                            Add to group
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="msg-chat-body">
                    {internalMsgs.length === 0 && (
                      <div className="msg-empty">
                        <MessageCircle size={28} style={{ opacity: 0.15 }} />
                        <p>No messages yet. Say hello!</p>
                      </div>
                    )}
                    {internalMsgs.map((msg) => {
                      const isMe = msg.sender_id === user?.id;
                      return (
                        <div key={msg.id} className={`msg-bubble-wrap${isMe ? ' msg-bubble-wrap--mine' : ' msg-bubble-wrap--theirs'}`}>
                          {!isMe && <p className="msg-sender-name">{msg.sender_name}</p>}
                          {msg.file_url ? (
                            <a href={msg.file_url} target="_blank" rel="noreferrer" className={`msg-bubble msg-bubble--file${isMe ? ' msg-bubble--mine' : ' msg-bubble--theirs'}`}>
                              <Paperclip size={12} /> {msg.file_name || msg.content}
                            </a>
                          ) : (
                            <div className={`msg-bubble${isMe ? ' msg-bubble--mine' : ' msg-bubble--theirs'}`}>{msg.content}</div>
                          )}
                          <p className="msg-time">{format(new Date(msg.created_at), 'h:mm a')}</p>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>

                  <form onSubmit={sendInternal} className="msg-send-form">
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                    />
                    <button type="button" className="msg-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">
                      <Paperclip size={15} />
                    </button>
                    <input
                      className="msg-send-input"
                      placeholder="Type a message…"
                      value={internalText}
                      onChange={(e) => setInternalText(e.target.value)}
                    />
                    <button type="submit" className="msg-send-btn" disabled={!internalText.trim()}>
                      <Send size={15} />
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── CLIENT CHAT ── */}
        {(tab === 'client' || isClient) && (
          <div className="messages-layout">
            {/* Project panel */}
            <div className="msg-projects-panel">
              <p className="msg-projects-panel__title" style={{ padding: '14px 16px 8px' }}>Projects</p>
              <div className="msg-project-list">
                {projects.length === 0 && (
                  <p className="msg-no-chats">No projects assigned yet</p>
                )}
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className={`msg-project-item${selectedProject?.id === p.id ? ' msg-project-item--active' : ''}`}
                    onClick={() => setSelectedProject(p)}
                  >
                    <p className="msg-project-item__name">{p.name}</p>
                    {p.client_name && <p className="msg-project-item__client">{p.client_name}</p>}
                    {p.members.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {p.members.map((m) => (
                          <span key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--ink-muted)' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.avatar_color, flexShrink: 0, display: 'inline-block' }} />
                            {m.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Chat area */}
            <div className="msg-chat-panel">
              {!selectedProject ? (
                <div className="msg-empty">
                  <MessageCircle size={36} style={{ opacity: 0.2 }} />
                  <p>Select a project to start chatting</p>
                </div>
              ) : (
                <>
                  <div className="msg-chat-header">
                    <p className="msg-chat-header__name">{selectedProject.name}</p>
                    <p className="msg-chat-header__sub">
                      {selectedProject.client_name ? `Client: ${selectedProject.client_name}` : 'No client'}
                      {selectedProject.members.length > 0 && (
                        <span style={{ marginLeft: 8 }}>
                          · {selectedProject.members.map((m) => m.name).join(', ')}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="msg-chat-body">
                    {clientMsgs.length === 0 && (
                      <div className="msg-empty">
                        <MessageCircle size={28} style={{ opacity: 0.15 }} />
                        <p>No messages yet. Say hello!</p>
                      </div>
                    )}
                    {clientMsgs.map((msg) => {
                      const isMe = msg.sender_id === user?.id;
                      const fileUrl = (msg as any).file_url;
                      const fileName = (msg as any).file_name;
                      return (
                        <div key={msg.id} className={`msg-bubble-wrap${isMe ? ' msg-bubble-wrap--mine' : ' msg-bubble-wrap--theirs'}`}>
                          {!isMe && <p className="msg-sender-name">{msg.sender_name}</p>}
                          {fileUrl ? (
                            <a href={fileUrl} target="_blank" rel="noreferrer" className={`msg-bubble msg-bubble--file${isMe ? ' msg-bubble--mine' : ' msg-bubble--theirs'}`}>
                              <Paperclip size={12} /> {fileName || msg.message}
                            </a>
                          ) : (
                            <div className={`msg-bubble${isMe ? ' msg-bubble--mine' : ' msg-bubble--theirs'}`}>{msg.message}</div>
                          )}
                          <p className="msg-time">{format(new Date(msg.created_at), 'h:mm a')}</p>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>

                  <form onSubmit={sendClient} className="msg-send-form">
                    <input type="file" ref={clientFileInputRef} style={{ display: 'none' }} onChange={handleClientFileUpload} />
                    <button type="button" className="msg-attach-btn" onClick={() => clientFileInputRef.current?.click()} title="Attach file">
                      <Paperclip size={15} />
                    </button>
                    <input
                      className="msg-send-input"
                      placeholder={`Message ${selectedProject.name}…`}
                      value={clientText}
                      onChange={(e) => setClientText(e.target.value)}
                    />
                    <button type="submit" className="msg-send-btn" disabled={!clientText.trim()}>
                      <Send size={15} />
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
