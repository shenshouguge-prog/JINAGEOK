/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  User, 
  Settings, 
  Search, 
  Volume2, 
  Music, 
  Mic2, 
  Highlighter, 
  ChevronUp, 
  ChevronDown, 
  Type,
  X,
  Check,
  Crown,
  Monitor,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Song {
  id: number;
  title: string;
  artist: string;
  videoUrl: string;
  lrcUrl: string;
  quality?: string;
}

interface Member {
  phone: string;
  level: 'guest' | 'monthly' | 'yearly';
  expiry_date: string | null;
}

interface LrcLine {
  time: number;
  text: string;
}

interface AppSettings {
  cloud_url: string;
  wechat_id: string;
  admin_password?: string;
}

// --- Utils ---
const parseLrc = (lrc: string): LrcLine[] => {
  const lines = lrc.split('\n');
  const result: LrcLine[] = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2})\]/g;

  lines.forEach(line => {
    const text = line.replace(timeExp, '').trim();
    if (!text) return;
    
    let match;
    timeExp.lastIndex = 0;
    while ((match = timeExp.exec(line)) !== null) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = parseInt(match[3]);
      result.push({
        time: min * 60 + sec + ms / 100,
        text
      });
    }
  });

  return result.sort((a, b) => a.time - b.time);
};

// --- Components ---

export default function App() {
  // State
  const [songs, setSongs] = useState<Song[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [lyrics, setLyrics] = useState<LrcLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
    return sessionStorage.getItem('ktv_admin_auth') === 'true';
  });
  const [adminPassword, setAdminPassword] = useState('');
  const [adminTab, setAdminTab] = useState<'settings' | 'members'>('settings');
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  
  const [member, setMember] = useState<Member | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings>({ 
    cloud_url: '', 
    wechat_id: ''
  });
  
  // Player Controls
  const [pitch, setPitch] = useState(0); // -6 to +6
  const [volume, setVolume] = useState(80);
  const [isOriginal, setIsOriginal] = useState(false);
  const [quality, setQuality] = useState<'high' | 'low'>('low');
  const [fontSize, setFontSize] = useState(24); // px, will scale with container
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch initial data
  useEffect(() => {
    const savedPhone = localStorage.getItem('ktv_member_phone');
    if (savedPhone) {
      handleRegister(savedPhone);
    } else {
      fetchSongs();
    }
    fetch('/api/settings').then(res => res.json()).then(setAppSettings);
  }, []);

  const fetchSongs = async (phone?: string) => {
    const url = phone ? `/api/songs?phone=${phone}` : '/api/songs';
    const res = await fetch(url);
    const data = await res.json();
    setSongs(data);
  };

  const handleRegister = async (phone: string) => {
    try {
      const res = await fetch('/api/member/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.success) {
        setMember(data.member);
        localStorage.setItem('ktv_member_phone', phone);
        fetchSongs(phone);
      } else {
        alert(data.message);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAdminLogin = async () => {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    });
    if (res.ok) {
      setIsAdminAuthenticated(true);
      sessionStorage.setItem('ktv_admin_auth', 'true');
    } else {
      alert('管理员密码错误');
    }
  };

  const fetchAllMembers = async () => {
    const res = await fetch('/api/admin/members');
    const data = await res.json();
    setAllMembers(data);
  };

  const updateMemberLevel = async (phone: string, level: 'guest' | 'monthly' | 'yearly') => {
    const res = await fetch('/api/admin/members/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, level })
    });
    if (res.ok) {
      fetchAllMembers();
      // If the updated member is the current user, refresh their status
      if (member?.phone === phone) {
        handleRegister(phone);
      }
    }
  };

  useEffect(() => {
    if (isAdminAuthenticated && isAdminModalOpen) {
      fetchAllMembers();
    }
  }, [isAdminAuthenticated, isAdminModalOpen]);

  // Load lyrics when song changes
  useEffect(() => {
    if (currentSong) {
      fetch(currentSong.lrcUrl)
        .then(res => res.text())
        .then(text => setLyrics(parseLrc(text)))
        .catch(() => setLyrics([]));
    }
  }, [currentSong]);

  // Handle video time update
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Current lyric line
  const currentLyricIndex = useMemo(() => {
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics[i].time) {
        return i;
      }
    }
    return -1;
  }, [lyrics, currentTime]);

  // Filtered songs
  const filteredSongs = useMemo(() => {
    if (!searchQuery) return [];
    return songs.filter(s => 
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [songs, searchQuery]);

  // Save settings
  const saveSettings = async (newSettings: Partial<AppSettings>) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    setAppSettings(prev => ({ ...prev, ...newSettings }));
  };

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden select-none"
      style={{ fontFamily: '"Inter", "Microsoft YaHei", "Heiti SC", sans-serif' }}
    >
      {/* --- Top Menu Bar --- */}
      <header className="flex items-center justify-between px-4 h-16 bg-neutral-900/50 backdrop-blur-md border-b border-white/5 z-50">
        {/* Member Account */}
        <button 
          onClick={() => setIsMemberModalOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${member?.level !== 'guest' ? 'bg-amber-500' : 'bg-indigo-500'}`}>
            {member?.level !== 'guest' ? <Crown size={18} /> : <User size={18} />}
          </div>
          <span className="text-sm font-medium hidden sm:block">
            {member ? (member.level === 'guest' ? '普通游客' : '高级会员') : '点击登录'}
          </span>
        </button>

        {/* Search Bar */}
        <div className="relative flex-1 max-w-md mx-4">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-neutral-400">
            <Search size={18} />
          </div>
          <input 
            type="text"
            placeholder="搜索歌曲、歌手..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
          
          {/* Search Results Dropdown */}
          <AnimatePresence>
            {searchQuery && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 right-0 mt-2 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
              >
                {filteredSongs.length > 0 ? (
                  filteredSongs.map(song => (
                    <button 
                      key={song.id}
                      onClick={() => {
                        setCurrentSong(song);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                    >
                      <div className="text-left">
                        <div className="font-medium">{song.title}</div>
                        <div className="text-xs text-neutral-400">{song.artist}</div>
                      </div>
                      <Music size={16} className="text-neutral-500" />
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-neutral-500 text-sm">
                    未找到相关歌曲
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Admin Settings */}
        <button 
          onClick={() => setIsAdminModalOpen(true)}
          className="p-2 rounded-full hover:bg-white/10 transition-colors text-neutral-400 hover:text-white"
        >
          <Settings size={22} />
        </button>
      </header>

      {/* --- Middle: Video & Lyrics Area --- */}
      <main className="flex-1 relative flex flex-col items-center justify-center overflow-hidden bg-black">
        {/* Video Player */}
        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
          {currentSong ? (
            <video 
              ref={videoRef}
              src={currentSong.videoUrl}
              className="w-full h-full object-contain"
              onTimeUpdate={handleTimeUpdate}
              autoPlay
              playsInline
              controls={false}
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-neutral-500">
              <Monitor size={64} strokeWidth={1} />
              <p className="text-lg">请在上方搜索并点播歌曲</p>
            </div>
          )}
        </div>

        {/* Lyrics Overlay */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-end pb-24 px-8">
          <div className="w-full max-w-4xl text-center">
            <AnimatePresence mode="wait">
              {currentLyricIndex >= 0 && (
                <motion.div
                  key={currentLyricIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                  style={{ fontSize: `${fontSize}px` }}
                  className="font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] leading-tight"
                >
                  {lyrics[currentLyricIndex].text}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="mt-4 opacity-60">
              {currentLyricIndex + 1 < lyrics.length && (
                <div style={{ fontSize: `${fontSize * 0.7}px` }} className="text-neutral-300">
                  {lyrics[currentLyricIndex + 1].text}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Lyric Font Size Controls (Top Right of Middle) */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 pointer-events-auto">
          <button 
            onClick={() => setFontSize(prev => Math.min(prev + 4, 64))}
            className="p-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg hover:bg-black/60 transition-colors"
            title="增大歌词"
          >
            <Type size={18} />
            <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-indigo-500 text-[8px]">+</span>
          </button>
          <button 
            onClick={() => setFontSize(prev => Math.max(prev - 4, 12))}
            className="p-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg hover:bg-black/60 transition-colors"
            title="减小歌词"
          >
            <Type size={18} />
            <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-neutral-500 text-[8px]">-</span>
          </button>
        </div>

        {/* Song Info Badge */}
        {currentSong && (
          <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-4 py-1.5 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium">{currentSong.title} - {currentSong.artist}</span>
          </div>
        )}
      </main>

      {/* --- Bottom Menu Bar: Controls --- */}
      <footer className="min-h-24 bg-neutral-900 border-t border-white/5 px-6 py-4 flex flex-wrap items-center justify-center sm:justify-between gap-6 z-50">
        <div className="flex flex-wrap items-center justify-center gap-6">
          {/* Pitch Control */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">升降调</span>
            <div className="flex items-center bg-white/5 rounded-xl p-1">
              <button 
                onClick={() => setPitch(p => Math.max(p - 1, -6))}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400"
              >
                <ChevronDown size={18} />
              </button>
              <span className="w-8 text-center font-mono font-bold text-indigo-400">
                {pitch > 0 ? `+${pitch}` : pitch}
              </span>
              <button 
                onClick={() => setPitch(p => Math.min(p + 1, 6))}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400"
              >
                <ChevronUp size={18} />
              </button>
            </div>
          </div>

          {/* Volume Control */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">音量</span>
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-2">
              <Volume2 size={18} className="text-neutral-400" />
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={volume}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setVolume(v);
                  if (videoRef.current) videoRef.current.volume = v / 100;
                }}
                className="w-24 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-xs font-mono w-6 text-neutral-400">{volume}</span>
            </div>
          </div>

          {/* Audio Track Switch */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">音轨</span>
            <button 
              onClick={() => setIsOriginal(!isOriginal)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                isOriginal 
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                : 'bg-white/5 text-neutral-400 hover:bg-white/10'
              }`}
            >
              <Mic2 size={18} />
              <span className="text-sm font-medium">{isOriginal ? '原唱' : '伴奏'}</span>
            </button>
          </div>

          {/* Quality Selection */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">音质</span>
            <div className="flex bg-white/5 rounded-xl p-1">
              <button 
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  !member || member.level === 'guest' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                低音质
              </button>
              <button 
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                  member && member.level !== 'guest' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-neutral-500'
                }`}
              >
                <Crown size={12} />
                高音质
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* --- Modals --- */}
      
      {/* Member Settings Modal */}
      <Modal 
        isOpen={isMemberModalOpen} 
        onClose={() => setIsMemberModalOpen(false)}
        title={member ? "会员中心" : "会员注册/登录"}
      >
        <div className="space-y-6">
          {!member ? (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto text-indigo-500">
                  <User size={32} />
                </div>
                <h3 className="text-lg font-bold">欢迎使用 CloudKTV Pro</h3>
                <p className="text-sm text-neutral-400">输入手机号即可快速注册/登录</p>
              </div>
              <div className="space-y-2">
                <input 
                  type="tel" 
                  placeholder="请输入手机号"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <button 
                  onClick={() => handleRegister(phoneInput)}
                  className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-colors"
                >
                  立即进入
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white ${member.level !== 'guest' ? 'bg-amber-500' : 'bg-neutral-700'}`}>
                  {member.level !== 'guest' ? <Crown size={32} /> : <User size={32} />}
                </div>
                <div>
                  <div className="text-lg font-bold flex items-center gap-2">
                    {member.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
                    {member.level !== 'guest' && <Crown size={16} className="text-amber-500" />}
                  </div>
                  <div className="text-sm text-neutral-400">
                    {member.level === 'guest' ? '普通游客' : `${member.level === 'monthly' ? '月度' : '年度'}会员`}
                    {member.expiry_date && ` · 到期时间: ${member.expiry_date}`}
                  </div>
                </div>
              </div>

              {member.level === 'guest' ? (
                <div className="space-y-4">
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                    <h4 className="font-bold text-amber-500 flex items-center gap-2">
                      <Crown size={16} />
                      开通高级会员
                    </h4>
                    <ul className="text-xs text-neutral-400 space-y-2">
                      <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500" /> 无损音质体验</li>
                      <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500" /> 优先点播权</li>
                      <li className="flex items-center gap-2"><Check size={12} className="text-emerald-500" /> 专属会员标识</li>
                    </ul>
                    <div className="pt-2">
                      <div className="text-xs text-neutral-500 mb-2">请添加客服微信并发送手机号开通：</div>
                      <div className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5">
                        <span className="font-mono text-indigo-400 font-bold">{appSettings.wechat_id}</span>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(appSettings.wechat_id);
                            alert('微信号已复制');
                          }}
                          className="text-[10px] bg-white/10 px-2 py-1 rounded hover:bg-white/20"
                        >
                          复制
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 text-center">
                      <div className="text-lg font-bold">¥29.9</div>
                      <div className="text-[10px] text-neutral-500">月度会员</div>
                    </div>
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 text-center">
                      <div className="text-lg font-bold">¥199</div>
                      <div className="text-[10px] text-neutral-500">年度会员</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-center">
                  <p className="text-sm text-emerald-400 font-medium">您已开启无损音质特权</p>
                </div>
              )}
              
              <button 
                onClick={() => {
                  localStorage.removeItem('ktv_member_phone');
                  setMember(null);
                  fetchSongs();
                }}
                className="w-full py-2 text-neutral-500 text-xs hover:text-neutral-300 transition-colors"
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Admin Settings Modal */}
      <Modal 
        isOpen={isAdminModalOpen} 
        onClose={() => {
          setIsAdminModalOpen(false);
          setAdminPassword('');
        }}
        title="管理员控制台"
      >
        {!isAdminAuthenticated ? (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto text-amber-500">
                <Settings size={32} />
              </div>
              <h3 className="text-lg font-bold">管理员验证</h3>
              <p className="text-sm text-neutral-400">请输入管理员密码以继续</p>
            </div>
            <div className="space-y-2">
              <input 
                type="password" 
                placeholder="管理员密码"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <button 
                onClick={handleAdminLogin}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition-colors"
              >
                验证并进入
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Tabs */}
            <div className="flex p-1 bg-white/5 rounded-xl">
              <button 
                onClick={() => setAdminTab('settings')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  adminTab === 'settings' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                系统设置
              </button>
              <button 
                onClick={() => setAdminTab('members')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  adminTab === 'members' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                会员管理
              </button>
            </div>

            {adminTab === 'settings' ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-2">
                    <Database size={14} />
                    歌库直连地址 (API/URL)
                  </label>
                  <input 
                    type="url" 
                    placeholder="https://api.ktv-cloud.com/v1"
                    value={appSettings.cloud_url}
                    onChange={(e) => saveSettings({ cloud_url: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-2">
                    客服微信号
                  </label>
                  <input 
                    type="text" 
                    value={appSettings.wechat_id}
                    onChange={(e) => saveSettings({ wechat_id: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-neutral-500 uppercase">修改管理员密码</label>
                  <input 
                    type="password" 
                    placeholder="新密码"
                    onBlur={(e) => {
                      if (e.target.value) {
                        saveSettings({ admin_password: e.target.value });
                        alert('管理员密码已更新');
                      }
                    }}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">自动更新歌库</span>
                    <div className="w-10 h-5 bg-indigo-500 rounded-full relative">
                      <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">启用多音轨切换</span>
                    <div className="w-10 h-5 bg-indigo-500 rounded-full relative">
                      <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                {allMembers.length > 0 ? (
                  allMembers.map(m => (
                    <div key={m.phone} className="p-4 bg-white/5 border border-white/5 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm">{m.phone}</span>
                          {m.level !== 'guest' && <Crown size={14} className="text-amber-500" />}
                        </div>
                        <span className="text-[10px] text-neutral-500">{m.expiry_date || '未开通'}</span>
                      </div>
                      
                      <div className="flex gap-2">
                        <button 
                          onClick={() => updateMemberLevel(m.phone, m.level === 'monthly' ? 'guest' : 'monthly')}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                            m.level === 'monthly' ? 'bg-indigo-500 text-white' : 'bg-white/5 text-neutral-400'
                          }`}
                        >
                          月会员
                        </button>
                        <button 
                          onClick={() => updateMemberLevel(m.phone, m.level === 'yearly' ? 'guest' : 'yearly')}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                            m.level === 'yearly' ? 'bg-amber-500 text-white' : 'bg-white/5 text-neutral-400'
                          }`}
                        >
                          年会员
                        </button>
                        <button 
                          onClick={() => updateMemberLevel(m.phone, 'guest')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400 hover:bg-red-500/20`}
                        >
                          重置
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-neutral-500 text-sm">暂无注册会员</div>
                )}
              </div>
            )}
            
            <button 
              onClick={() => {
                setIsAdminAuthenticated(false);
                sessionStorage.removeItem('ktv_admin_auth');
              }}
              className="w-full py-2 text-neutral-500 text-[10px] hover:text-neutral-300 transition-colors"
            >
              退出管理模式
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

// --- Helper Components ---

function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md bg-neutral-900 border border-white/10 rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
              <h2 className="text-lg font-bold">{title}</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto no-scrollbar flex-1">
              {children}
            </div>
            <div className="px-6 py-4 bg-white/5 flex justify-end flex-shrink-0">
              <button 
                onClick={onClose}
                className="px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-colors"
              >
                确定
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
