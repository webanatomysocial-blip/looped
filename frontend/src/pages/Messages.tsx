import { useEffect, useState, useRef } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import {
  Send, MessageCircle, Plus, Users, User as UserIcon, Paperclip, UserPlus, X,
  Search, Check, CheckCheck, Pin, PinOff, LogOut, MoreVertical, Reply,
  Pencil, Trash2, Forward, Smile, Phone, Video,
} from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { messagesApi, projectsApi, internalChatApi, usersApi } from '../services/api';
import { Message, Project, InternalChat, InternalMessage, User } from '../types';
import '../css/pages/Messages.css';

type Tab = 'internal' | 'client';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function formatMsgDate(d: string | Date | null | undefined) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  if (isToday(dt)) return format(dt, 'h:mm a');
  if (isYesterday(dt)) return 'Yesterday';
  return format(dt, 'dd/MM/yy');
}

function dateDivider(d: string | Date | null | undefined) {
  if (!d) return 'Today';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  if (isToday(dt)) return 'Today';
  if (isYesterday(dt)) return 'Yesterday';
  return format(dt, 'MMMM d, yyyy');
}

function renderWithMentions(text: string) {
  if (!text) return null;
  const parts = text.split(/(@[A-Za-z][A-Za-z0-9 ]*)/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <strong key={i} style={{ color: '#00a884' }}>{p}</strong>
      : <span key={i}>{p}</span>
  );
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
  const { socket, joinChat } = useSocket();
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
  const groupAvatarRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; preview: string; caption: string } | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionIndex, setMentionIndex] = useState(0);

  // New feature state
  const [msgSearch, setMsgSearch] = useState('');
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [replyTo, setReplyTo] = useState<InternalMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<InternalMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [contextMenu, setContextMenu] = useState<{ msg: InternalMessage; x: number; y: number } | null>(null);
  const [forwardMsg, setForwardMsg] = useState<InternalMessage | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | null>(null); // msgId
  const inputRef = useRef<HTMLInputElement>(null);

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

  const loadMessages = (chatId: number, search?: string) =>
    internalChatApi.getMessages(chatId, search || undefined).then(r => {
      setInternalMsgs(r.data);
      // clear unread badge locally after backend marks read
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c));
    });

  useEffect(() => {
    if (!activeChat) return;
    loadMessages(activeChat.id, msgSearch || undefined);
    joinChat(activeChat.id);
    // Fallback poll every 15s in case socket misses something
    const iv = setInterval(() => loadMessages(activeChat.id, msgSearch || undefined), 15000);
    return () => clearInterval(iv);
  }, [activeChat, msgSearch]);

  // Real-time: push new messages via socket
  useEffect(() => {
    if (!socket) return;
    const handler = ({ chatId, message }: { chatId: number; message: any }) => {
      // Update chat list preview for all chats
      setChats(prev => prev.map(c => c.id === chatId
        ? { ...c, last_message: message.content, last_message_at: message.created_at, unread_count: activeChat?.id === chatId ? 0 : (c.unread_count || 0) + 1 }
        : c));
      // For active chat: reload full messages (socket message is missing reactions/reply_to/read fields)
      if (activeChat?.id === chatId) loadMessages(chatId);
    };
    socket.on('new_message', handler);
    return () => { socket.off('new_message', handler); };
  }, [socket, activeChat?.id]);

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

  // Close context menu on outside click
  useEffect(() => {
    const handler = () => { setContextMenu(null); setShowEmojiPicker(null); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const refreshChats = async () => {
    const r = await internalChatApi.listChats();
    // Keep unread_count=0 for the active chat so the badge doesn't flicker back
    setChats(r.data.map((c: InternalChat) =>
      activeChat && c.id === activeChat.id ? { ...c, unread_count: 0 } : c
    ));
    return r.data as InternalChat[];
  };

  const sendInternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalText.trim() || !activeChat) return;
    await internalChatApi.sendMessage(activeChat.id, internalText, replyTo?.id ?? null);
    setInternalText(''); setReplyTo(null);
    loadMessages(activeChat.id);
  };

  const sendClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientText.trim() || !selectedProject) return;
    await messagesApi.send(clientText, selectedProject.id);
    setClientText('');
    messagesApi.list(selectedProject.id).then(r => setClientMsgs(r.data));
  };

  const isImageFile = (name: string | null | undefined) =>
    /\.(jpg|jpeg|png|gif|webp)$/i.test(name || '');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !activeChat) return;
    const file = e.target.files[0];
    if (isImageFile(file.name)) {
      const preview = URL.createObjectURL(file);
      setPendingFile({ file, preview, caption: '' });
    } else {
      const fd = new FormData(); fd.append('file', file);
      await internalChatApi.uploadFile(activeChat.id, fd);
      loadMessages(activeChat.id);
    }
    e.target.value = '';
  };

  const sendPendingFile = async () => {
    if (!pendingFile || !activeChat) return;
    const fd = new FormData();
    fd.append('file', pendingFile.file);
    if (pendingFile.caption.trim()) fd.append('caption', pendingFile.caption.trim());
    await internalChatApi.uploadFile(activeChat.id, fd);
    URL.revokeObjectURL(pendingFile.preview);
    setPendingFile(null);
    loadMessages(activeChat.id);
  };

  const handleClientFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedProject) return;
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    await messagesApi.uploadFile(selectedProject.id, fd);
    messagesApi.list(selectedProject.id).then(r => setClientMsgs(r.data));
    e.target.value = '';
  };

  // @mention helpers
  const chatMembers = activeChat?.members.filter(m => m.id !== user?.id) ?? [];
  const mentionSuggestions = mentionQuery !== null
    ? chatMembers.filter(m => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : [];

  const handleInternalTextChange = (val: string) => {
    setInternalText(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx !== -1) {
      const after = val.slice(atIdx + 1);
      // keep dropdown open while typed portion still has a match (supports multi-word names)
      const hasMatch = chatMembers.some(m => m.name.toLowerCase().startsWith(after.toLowerCase()));
      if (hasMatch || after === '') { setMentionQuery(after); setMentionIndex(0); return; }
    }
    setMentionQuery(null);
  };

  const insertMention = (name: string) => {
    const atIdx = internalText.lastIndexOf('@');
    const newText = internalText.slice(0, atIdx) + '@' + name + ' ';
    setInternalText(newText);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const addMembersToGroup = async () => {
    if (!activeChat || !addMemberIds.length) return;
    await Promise.all(addMemberIds.map(uid => internalChatApi.addMember(activeChat.id, uid)));
    const list = await refreshChats();
    const found = list.find((c: InternalChat) => c.id === activeChat.id);
    if (found) setActiveChat(found);
    setShowAddMember(false); setAddMemberIds([]);
  };

  const createChat = async () => {
    if (!selectedMembers.length) return;
    const r = await internalChatApi.createChat({ type: newChatType, name: newChatType === 'group' ? newChatName : undefined, member_ids: selectedMembers });
    const newId = r.data.id;
    const list = await refreshChats();
    const found = list.find((c: InternalChat) => c.id === newId);
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
    const list = await refreshChats();
    const found = list.find((c: InternalChat) => c.id === activeChat.id);
    if (found) setActiveChat(found);
    setEditingName(false);
  };

  const handleGroupAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !activeChat) return;
    const fd = new FormData(); fd.append('avatar', e.target.files[0]);
    await internalChatApi.uploadGroupAvatar(activeChat.id, fd);
    const list = await refreshChats();
    const found = list.find((c: InternalChat) => c.id === activeChat.id);
    if (found) setActiveChat(found);
    e.target.value = '';
  };

  const handleEditSave = async () => {
    if (!editingMsg || !editText.trim() || !activeChat) return;
    await internalChatApi.editMessage(activeChat.id, editingMsg.id, editText);
    setEditingMsg(null); setEditText('');
    loadMessages(activeChat.id);
  };

  const handleDelete = async (msg: InternalMessage) => {
    if (!activeChat) return;
    await internalChatApi.deleteMessage(activeChat.id, msg.id);
    loadMessages(activeChat.id);
  };

  const handleReact = async (msgId: number, emoji: string) => {
    if (!activeChat) return;
    await internalChatApi.reactMessage(activeChat.id, msgId, emoji);
    setShowEmojiPicker(null);
    loadMessages(activeChat.id);
  };

  const handleForwardTo = async (toChatId: number) => {
    if (!forwardMsg || !activeChat) return;
    await internalChatApi.forwardMessage(activeChat.id, forwardMsg.id, toChatId);
    setForwardMsg(null);
  };

  const handlePin = async (chat: InternalChat) => {
    await internalChatApi.pinChat(chat.id);
    refreshChats();
  };

  const handleLeave = async () => {
    if (!activeChat) return;
    if (!confirm('Leave this group?')) return;
    await internalChatApi.leaveGroup(activeChat.id);
    setActiveChat(null);
    refreshChats();
  };

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

  const headerName = tab === 'internal'
    ? (activeChat ? getChatLabel(activeChat) : '')
    : (selectedProject?.name ?? '');
  const headerSub = tab === 'internal'
    ? (activeChat ? activeChat.members.map(m => m.name).join(', ') : '')
    : (selectedProject ? [selectedProject.client_name, ...selectedProject.members.map(m => m.name)].filter(Boolean).join(', ') : '');
  const headerAvatar = tab === 'internal' && activeChat
    ? (activeChat.type === 'direct' ? getChatOther(activeChat) : null)
    : null;

  const renderInternalBubbles = (msgs: InternalMessage[]) => {
    const items = withDividers(msgs);
    return items.map((item, idx) => {
      if ('__divider' in item) {
        return <div key={`div-${idx}`} className="wa-date-divider"><span>{item.__divider}</span></div>;
      }
      const m = item as InternalMessage;
      const isMe = m.sender_id === user?.id;
      const isDeleted = !!m.deleted_at;

      // Group reactions by emoji
      const reactionMap: Record<string, { count: number; mine: boolean; names: string[] }> = {};
      for (const r of (m.reactions || [])) {
        if (!reactionMap[r.emoji]) reactionMap[r.emoji] = { count: 0, mine: false, names: [] };
        reactionMap[r.emoji].count++;
        reactionMap[r.emoji].names.push(r.user_name);
        if (r.user_id === user?.id) reactionMap[r.emoji].mine = true;
      }

      return (
        <div key={m.id} className={`wa-bubble-wrap wa-bubble-wrap--${isMe ? 'mine' : 'theirs'}`}>
          {!isMe && <p className="wa-sender-name">{m.sender_name?.split(' ')[0]}</p>}

          <div className="wa-bubble-outer" style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
            {/* Context menu trigger */}
            {!isDeleted && (
              <button
                className="wa-ctx-btn"
                onClick={e => {
                  e.stopPropagation();
                  const menuW = 170, menuH = 220;
                  const x = Math.min(e.clientX, window.innerWidth - menuW - 25);
                  const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
                  setContextMenu({ msg: m, x, y });
                  setShowEmojiPicker(null);
                }}
              >
                <MoreVertical size={13} />
              </button>
            )}

            {/* Forwarded label */}
            {m.forwarded_from_id && (
              <div className="wa-forwarded-label"><Forward size={10} /> Forwarded</div>
            )}

            {/* Reply quote */}
            {m.reply_to && (
              <div className={`wa-reply-quote wa-reply-quote--${isMe ? 'mine' : 'theirs'}`}>
                <span className="wa-reply-quote-name">{m.reply_to.deleted_at ? 'Deleted message' : m.reply_to.sender_name}</span>
                <span className="wa-reply-quote-text">{m.reply_to.deleted_at ? '🚫 This message was deleted' : (m.reply_to.content || '').slice(0, 80)}</span>
              </div>
            )}

            {isDeleted ? (
              <div className={`wa-bubble wa-bubble--${isMe ? 'mine' : 'theirs'} wa-bubble--deleted`}>
                🚫 This message was deleted
              </div>
            ) : m.file_url && isImageFile(m.file_name) ? (
              <div className={`wa-bubble wa-bubble--img wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
                <a href={m.file_url} target="_blank" rel="noreferrer">
                  <img src={m.file_url} alt={m.file_name || 'image'} className="wa-img-preview" />
                </a>
                {m.content && m.content !== m.file_name && (
                  <div style={{ padding: '4px 6px 2px', fontSize: 13 }}>{renderWithMentions(m.content)}</div>
                )}
                <div className="wa-bubble-footer" style={{ padding: '4px 6px 2px' }}>
                  <span className="wa-time">{format(new Date(m.created_at), 'h:mm a')}</span>
                  {isMe && <span className={`wa-tick${m.read_by_other ? ' wa-tick--read' : ''}`}><CheckCheck size={14} /></span>}
                </div>
              </div>
            ) : m.file_url ? (
              <a href={m.file_url} target="_blank" rel="noreferrer" className={`wa-bubble wa-bubble--file wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
                <Paperclip size={12} /> {m.file_name || m.content}
              </a>
            ) : (
              <div className={`wa-bubble wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
                {renderWithMentions(m.content)}
                <div className="wa-bubble-footer">
                  {m.edited_at && <span className="wa-edited">edited</span>}
                  <span className="wa-time">{format(new Date(m.created_at), 'h:mm a')}</span>
                  {isMe && (
                    <span className={`wa-tick${m.read_by_other ? ' wa-tick--read' : ''}`}>
                      <CheckCheck size={14} />
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Reactions */}
            {Object.keys(reactionMap).length > 0 && (
              <div className="wa-reactions">
                {Object.entries(reactionMap).map(([emoji, data]) => (
                  <button
                    key={emoji}
                    className={`wa-reaction-chip${data.mine ? ' mine' : ''}`}
                    title={data.names.join(', ')}
                    onClick={() => handleReact(m.id, emoji)}
                  >
                    {emoji} {data.count > 1 && <span>{data.count}</span>}
                  </button>
                ))}
                <button className="wa-reaction-chip wa-reaction-add" onClick={e => { e.stopPropagation(); setShowEmojiPicker(showEmojiPicker === m.id ? null : m.id); }}>
                  <Smile size={11} />
                </button>
              </div>
            )}

            {/* Emoji quick picker */}
            {showEmojiPicker === m.id && (
              <div className={`wa-emoji-picker wa-emoji-picker--${isMe ? 'mine' : 'theirs'}`} onClick={e => e.stopPropagation()}>
                {QUICK_EMOJIS.map(e => (
                  <button key={e} className="wa-emoji-opt" onClick={() => handleReact(m.id, e)}>{e}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    });
  };

  const renderClientBubbles = (msgs: Message[]) => {
    const items = withDividers(msgs);
    return items.map((item, idx) => {
      if ('__divider' in item) {
        return <div key={`div-${idx}`} className="wa-date-divider"><span>{(item as any).__divider}</span></div>;
      }
      const m = item as any;
      const isMe = m.sender_id === user?.id;
      return (
        <div key={m.id} className={`wa-bubble-wrap wa-bubble-wrap--${isMe ? 'mine' : 'theirs'}`}>
          {!isMe && <p className="wa-sender-name">{m.sender_name?.split(' ')[0]}</p>}
          {m.file_url && isImageFile(m.file_name) ? (
            <a href={m.file_url} target="_blank" rel="noreferrer" className={`wa-bubble wa-bubble--img wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
              <img src={m.file_url} alt={m.file_name || 'image'} className="wa-img-preview" />
              <div className="wa-bubble-footer" style={{ padding: '4px 6px 2px' }}>
                <span className="wa-time">{format(new Date(m.created_at), 'h:mm a')}</span>
                {isMe && <span className="wa-tick"><CheckCheck size={14} /></span>}
              </div>
            </a>
          ) : m.file_url ? (
            <a href={m.file_url} target="_blank" rel="noreferrer" className={`wa-bubble wa-bubble--file wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
              <Paperclip size={12} /> {m.file_name || m.message}
            </a>
          ) : (
            <div className={`wa-bubble wa-bubble--${isMe ? 'mine' : 'theirs'}`}>
              {m.message}
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
      {/* Context menu */}
      {contextMenu && (
        <div
          className="wa-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          {/* React row */}
          <div className="wa-context-emojis">
            {QUICK_EMOJIS.map(e => (
              <button key={e} className="wa-emoji-opt" onClick={() => { handleReact(contextMenu.msg.id, e); setContextMenu(null); }}>{e}</button>
            ))}
          </div>
          <div className="wa-context-divider" />
          <button className="wa-context-item" onClick={() => { setReplyTo(contextMenu.msg); setContextMenu(null); inputRef.current?.focus(); }}>
            <Reply size={14} /> Reply
          </button>
          {contextMenu.msg.sender_id === user?.id && (
            <button className="wa-context-item" onClick={() => { setEditingMsg(contextMenu.msg); setEditText(contextMenu.msg.content); setContextMenu(null); }}>
              <Pencil size={14} /> Edit
            </button>
          )}
          <button className="wa-context-item" onClick={() => { setForwardMsg(contextMenu.msg); setContextMenu(null); }}>
            <Forward size={14} /> Forward
          </button>
          {contextMenu.msg.sender_id === user?.id && (
            <button className="wa-context-item wa-context-item--danger" onClick={() => { handleDelete(contextMenu.msg); setContextMenu(null); }}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      )}

      {/* Forward modal */}
      {forwardMsg && (
        <div className="wa-modal-overlay" onClick={() => { setForwardMsg(null); setForwardSearch(''); }}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <span>Forward to…</span>
              <button className="wa-icon-btn" onClick={() => { setForwardMsg(null); setForwardSearch(''); }}><X size={16} /></button>
            </div>
            <div className="wa-modal-body">
              <p className="wa-modal-preview">"{(forwardMsg.content || '').slice(0, 80)}{(forwardMsg.content || '').length > 80 ? '…' : ''}"</p>
              {/* Search */}
              <div className="wa-search" style={{ marginBottom: 8 }}>
                <Search size={13} />
                <input
                  autoFocus
                  placeholder="Search conversations…"
                  value={forwardSearch}
                  onChange={e => setForwardSearch(e.target.value)}
                />
              </div>
              <div className="wa-member-list" style={{ maxHeight: 280 }}>
                {chats
                  .filter(c => c.id !== activeChat?.id && getChatLabel(c).toLowerCase().includes(forwardSearch.toLowerCase()))
                  .map(c => {
                    const other = getChatOther(c);
                    return (
                      <div key={c.id} className="wa-member-row" onClick={() => { handleForwardTo(c.id); setForwardSearch(''); }}>
                        {c.type === 'direct' && other
                          ? <WaAvatar name={other.name} color={other.avatar_color} avatarUrl={other.avatar_url} size={36} />
                          : c.avatar_url
                            ? <div className="wa-avatar wa-avatar--group" style={{ width: 36, height: 36 }}><img src={c.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
                            : <div className="wa-avatar wa-avatar--group" style={{ width: 36, height: 36, fontSize: 14 }}><Users size={16} /></div>}
                        <div>
                          <p className="wa-member-name" style={{ marginBottom: 1 }}>{getChatLabel(c)}</p>
                          <p className="wa-member-role">{c.type === 'group' ? `${c.members.length} members` : 'Direct'}</p>
                        </div>
                      </div>
                    );
                  })}
                {chats.filter(c => c.id !== activeChat?.id && getChatLabel(c).toLowerCase().includes(forwardSearch.toLowerCase())).length === 0 && (
                  <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-muted)', padding: '16px 0' }}>No conversations found</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: 0 }}>
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

            {!isClient && (
              <div className="wa-tabs">
                <button className={`wa-tab${tab === 'internal' ? ' wa-tab--active' : ''}`} onClick={() => setTab('internal')}>Team</button>
                <button className={`wa-tab${tab === 'client' ? ' wa-tab--active' : ''}`} onClick={() => setTab('client')}>Clients</button>
              </div>
            )}

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
                        <div
                          key={chat.id}
                          className={`wa-chat-item${activeChat?.id === chat.id ? ' wa-chat-item--active' : ''}`}
                          onClick={() => { setActiveChat(chat); setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unread_count: 0 } : c)); }}
                        >
                          {chat.type === 'direct' && other
                            ? <WaAvatar name={other.name} color={other.avatar_color} avatarUrl={other.avatar_url} />
                            : chat.avatar_url
                              ? <div className="wa-avatar wa-avatar--group"><img src={chat.avatar_url} alt="group" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
                              : <div className="wa-avatar wa-avatar--group"><Users size={20} /></div>}
                          <div className="wa-chat-info">
                            <div className="wa-chat-name-row">
                              <p className="wa-chat-name">{getChatLabel(chat)}</p>
                              {!!chat.is_pinned && <Pin size={10} color="#00a884" />}
                            </div>
                            <p className="wa-chat-preview">{last ? (last.content || '').slice(0, 35) + ((last.content || '').length > 35 ? '…' : '') : 'No messages yet'}</p>
                          </div>
                          <div className="wa-chat-meta">
                            {last && <span className="wa-chat-time">{formatMsgDate(last.created_at)}</span>}
                            {chat.unread_count > 0 && <span className="wa-unread-badge">{chat.unread_count}</span>}
                          </div>
                          {/* Pin/unpin context */}
                          <button
                            className="wa-chat-pin-btn"
                            title={chat.is_pinned ? 'Unpin' : 'Pin'}
                            onClick={e => { e.stopPropagation(); handlePin(chat); }}
                          >
                            {chat.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
                          </button>
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
            {((tab === 'internal' && !activeChat) || (tab === 'client' && !selectedProject)) && (
              <div className="wa-empty-state">
                <div className="wa-empty-icon"><MessageCircle size={36} color="#00a884" /></div>
                <p>{tab === 'internal' ? 'Select a conversation to start chatting' : 'Select a project to view messages'}</p>
              </div>
            )}

            {((tab === 'internal' && activeChat) || ((tab === 'client' || isClient) && selectedProject)) && (
              <>
                {/* Header */}
                <div className="wa-chat-header">
                  <input ref={groupAvatarRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleGroupAvatarChange} />
                  {headerAvatar
                    ? <WaAvatar name={headerAvatar.name} color={headerAvatar.avatar_color} avatarUrl={headerAvatar.avatar_url} />
                    : tab === 'internal' && activeChat?.type === 'group'
                      ? <div className="wa-avatar wa-avatar--group wa-group-avatar-btn" title="Change group photo" onClick={() => groupAvatarRef.current?.click()}>
                          {activeChat.avatar_url
                            ? <img src={activeChat.avatar_url} alt="group" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <Users size={20} />}
                          <div className="wa-group-avatar-overlay"><Paperclip size={14} color="#fff" /></div>
                        </div>
                      : <div className="wa-avatar" style={{ background: tab === 'client' ? '#5b8dee' : '#00a884', fontSize: 17, fontWeight: 700, color: '#fff' }}>
                          {headerName[0]?.toUpperCase()}
                        </div>}
                  <div className="wa-chat-header-info">
                    {tab === 'internal' && activeChat?.type === 'group' && editingName
                      ? <input autoFocus className="wa-new-input" style={{ padding: '4px 8px', fontSize: 14, fontWeight: 700, width: '100%' }}
                          value={renameVal} onChange={e => setRenameVal(e.target.value)}
                          onBlur={saveRename}
                          onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingName(false); }} />
                      : <p className="wa-chat-header-name"
                          style={tab === 'internal' && activeChat?.type === 'group' ? { cursor: 'pointer' } : undefined}
                          title={tab === 'internal' && activeChat?.type === 'group' ? 'Click to rename' : undefined}
                          onClick={() => { if (tab === 'internal' && activeChat?.type === 'group') { setRenameVal(getChatLabel(activeChat)); setEditingName(true); } }}
                        >{headerName}</p>
                    }
                    <p className="wa-chat-header-sub">{headerSub}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {/* Call buttons — DM only */}
                    {tab === 'internal' && activeChat?.type === 'direct' && (() => {
                      const other = activeChat.members?.find((m: any) => m.id !== user?.id);
                      if (!other) return null;
                      const startCall = (type: 'audio' | 'video') => (window as any).__startCall?.(other.id, other.name, type);
                      return (
                        <>
                          <button className="wa-icon-btn" title="Audio call" onClick={() => startCall('audio')}>
                            <Phone size={18} />
                          </button>
                          <button className="wa-icon-btn" title="Video call" onClick={() => startCall('video')}>
                            <Video size={18} />
                          </button>
                        </>
                      );
                    })()}
                    {/* Search within chat */}
                    {tab === 'internal' && (
                      <button className="wa-icon-btn" title="Search messages" onClick={() => { setShowMsgSearch(v => !v); if (showMsgSearch) setMsgSearch(''); }}>
                        <Search size={18} />
                      </button>
                    )}
                    {tab === 'internal' && activeChat?.type === 'group' && (
                      <>
                        <button className="wa-icon-btn" title="Add member" onClick={() => { setShowAddMember(v => !v); setAddMemberIds([]); }}>
                          {showAddMember ? <X size={18} /> : <UserPlus size={18} />}
                        </button>
                        <button className="wa-icon-btn wa-icon-btn--danger" title="Leave group" onClick={handleLeave}>
                          <LogOut size={18} />
                        </button>
                      </>
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

                {/* Message search bar */}
                {showMsgSearch && tab === 'internal' && (
                  <div className="wa-msg-search-bar">
                    <Search size={13} color="#667781" />
                    <input
                      autoFocus
                      placeholder="Search in conversation…"
                      value={msgSearch}
                      onChange={e => setMsgSearch(e.target.value)}
                    />
                    {msgSearch && <button onClick={() => setMsgSearch('')}><X size={13} /></button>}
                  </div>
                )}

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

                {/* Messages body */}
                <div className="wa-body">
                  {tab === 'internal' && activeChat && (
                    internalMsgs.length === 0
                      ? <div className="wa-empty-state" style={{ flex: 'unset', marginTop: 40 }}>
                          <p>{msgSearch ? 'No messages match your search' : 'No messages yet — say hello! 👋'}</p>
                        </div>
                      : renderInternalBubbles(internalMsgs)
                  )}
                  {(tab === 'client' || isClient) && selectedProject && (
                    clientMsgs.length === 0
                      ? <div className="wa-empty-state" style={{ flex: 'unset', marginTop: 40 }}><p>No messages yet — say hello! 👋</p></div>
                      : renderClientBubbles(clientMsgs)
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Image caption modal */}
                {pendingFile && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 50,
                    background: 'rgba(0,0,0,0.92)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 12,
                  }}>
                    <button onClick={() => { URL.revokeObjectURL(pendingFile.preview); setPendingFile(null); setMentionQuery(null); }}
                      style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                      <X size={16} />
                    </button>
                    <img src={pendingFile.preview} alt="preview"
                      style={{ maxWidth: '75%', maxHeight: '55vh', objectFit: 'contain', borderRadius: 10, marginBottom: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />

                    {/* @mention dropdown inside caption modal */}
                    {mentionQuery !== null && mentionSuggestions.length > 0 && (
                      <div style={{
                        width: '70%', marginBottom: 8,
                        background: '#1f2937', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10, overflow: 'hidden',
                      }}>
                        {mentionSuggestions.map((m, i) => (
                          <button key={m.id} onMouseDown={() => {
                            const atIdx = pendingFile.caption.lastIndexOf('@');
                            const newCaption = pendingFile.caption.slice(0, atIdx) + '@' + m.name + ' ';
                            setPendingFile(f => f ? { ...f, caption: newCaption } : f);
                            setMentionQuery(null);
                          }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                              padding: '8px 14px', background: i === mentionIndex ? 'rgba(255,255,255,0.08)' : 'none',
                              border: 'none', cursor: 'pointer',
                            }}>
                            <WaAvatar name={m.name} color={m.avatar_color} avatarUrl={m.avatar_url} size={28} />
                            <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{m.name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={{ width: '70%', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 24, padding: '10px 16px' }}>
                      <input
                        autoFocus
                        placeholder="Add a caption… (type @ to mention)"
                        value={pendingFile.caption}
                        onChange={e => {
                          const val = e.target.value;
                          setPendingFile(f => f ? { ...f, caption: val } : f);
                          // detect @mention
                          const atIdx = val.lastIndexOf('@');
                          if (atIdx !== -1) {
                            const after = val.slice(atIdx + 1);
                            const hasMatch = chatMembers.some(m => m.name.toLowerCase().startsWith(after.toLowerCase()));
                            if (hasMatch || after === '') { setMentionQuery(after); setMentionIndex(0); }
                            else setMentionQuery(null);
                          } else {
                            setMentionQuery(null);
                          }
                        }}
                        onKeyDown={e => {
                          if (mentionQuery !== null && mentionSuggestions.length > 0) {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); return; }
                            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const atIdx = pendingFile.caption.lastIndexOf('@');
                              setPendingFile(f => f ? { ...f, caption: f.caption.slice(0, atIdx) + '@' + mentionSuggestions[mentionIndex].name + ' ' } : f);
                              setMentionQuery(null);
                              return;
                            }
                          }
                          if (e.key === 'Enter') sendPendingFile();
                          if (e.key === 'Escape') setMentionQuery(null);
                        }}
                        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 14 }}
                      />
                      <button onClick={sendPendingFile}
                        style={{ background: '#00a884', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                        <Send size={16} color="#fff" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Edit mode bar */}
                {editingMsg && (
                  <div className="wa-reply-bar">
                    <div className="wa-reply-bar-inner">
                      <Pencil size={14} color="#00a884" />
                      <div>
                        <p className="wa-reply-bar-title">Edit message</p>
                        <p className="wa-reply-bar-text">{(editingMsg.content || '').slice(0, 60)}</p>
                      </div>
                    </div>
                    <button className="wa-icon-btn" onClick={() => { setEditingMsg(null); setEditText(''); }}><X size={14} /></button>
                  </div>
                )}

                {/* Reply bar */}
                {replyTo && !editingMsg && (
                  <div className="wa-reply-bar">
                    <div className="wa-reply-bar-inner">
                      <Reply size={14} color="#00a884" />
                      <div>
                        <p className="wa-reply-bar-title">{replyTo.sender_name}</p>
                        <p className="wa-reply-bar-text">{(replyTo.content || '').slice(0, 60)}</p>
                      </div>
                    </div>
                    <button className="wa-icon-btn" onClick={() => setReplyTo(null)}><X size={14} /></button>
                  </div>
                )}

                {/* @mention dropdown */}
                {mentionQuery !== null && mentionSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', bottom: 64, left: 16, zIndex: 20,
                    background: '#fff', border: '1px solid #e5e7eb',
                    borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    minWidth: 180, maxHeight: 200, overflowY: 'auto',
                  }}>
                    {mentionSuggestions.map((m, i) => (
                      <button key={m.id} onMouseDown={() => insertMention(m.name)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                          padding: '8px 14px', background: i === mentionIndex ? '#f3f4f6' : 'none',
                          border: 'none', cursor: 'pointer', textAlign: 'left',
                        }}>
                        <WaAvatar name={m.name} color={m.avatar_color} avatarUrl={m.avatar_url} size={28} />
                        <span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Input bar */}
                <form
                  onSubmit={editingMsg
                    ? async (e) => { e.preventDefault(); await handleEditSave(); }
                    : tab === 'internal' ? sendInternal : sendClient}
                  className="wa-input-bar"
                >
                  <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                  <input type="file" ref={clientFileRef} style={{ display: 'none' }} onChange={handleClientFileUpload} />
                  <input
                    ref={inputRef}
                    className="wa-input"
                    placeholder={editingMsg ? 'Edit message…' : 'Type a message'}
                    value={editingMsg ? editText : (tab === 'internal' ? internalText : clientText)}
                    onChange={e => {
                      if (editingMsg) { setEditText(e.target.value); }
                      else if (tab === 'internal') { handleInternalTextChange(e.target.value); }
                      else { setClientText(e.target.value); }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape' && editingMsg) { setEditingMsg(null); setEditText(''); }
                      if (e.key === 'Escape' && replyTo) setReplyTo(null);
                      if (e.key === 'Escape' && mentionQuery !== null) setMentionQuery(null);
                      if (mentionQuery !== null && mentionSuggestions.length > 0) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); }
                        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); }
                        if (e.key === 'Enter') { e.preventDefault(); insertMention(mentionSuggestions[mentionIndex].name); }
                      }
                    }}
                  />
                  <button type="submit" className="wa-send-btn"
                    disabled={editingMsg ? !editText.trim() : (tab === 'internal' ? !internalText.trim() : !clientText.trim())}>
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
