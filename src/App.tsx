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
  Plus,
  Minus,
  Type,
  X,
  Check,
  Crown,
  Monitor,
  Database,
  Heart,
  ListMusic,
  Play,
  Pause
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Tone from 'tone';

// --- Types ---
interface Song {
  id: number;
  title: string;
  artist: string;
  url: string;
  vocalsUrl?: string | null;
  lrcUrl: string;
  quality?: string;
  singerImg?: string | null;
}

interface Member {
  phone: string;
  level: 'guest' | 'monthly' | 'yearly';
  expiry_date: string | null;
  created_at: string;
}

interface Transaction {
  id: number;
  phone: string;
  level: string;
  amount: number;
  method: string;
  tx_id_last4: string;
  status: 'pending_audit' | 'verified' | 'invalid';
  created_at: string;
}

interface LrcLine {
  time: number;
  text: string;
}

interface AppSettings {
  wechat_id: string;
  wechat_qr: string;
  alipay_qr: string;
  external_music_dir?: string;
  admin_password?: string;
}

// --- Utils ---
const parseLrc = (lrc: string): LrcLine[] => {
  if (!lrc) return [];
  // Remove BOM if present
  const cleanLrc = lrc.replace(/^\uFEFF/, '');
  const lines = cleanLrc.split(/\r?\n/);
  const result: LrcLine[] = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

  lines.forEach(line => {
    const text = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!text) return;
    
    let match;
    timeExp.lastIndex = 0;
    while ((match = timeExp.exec(line)) !== null) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const msStr = match[3];
      const ms = parseInt(msStr) / (msStr.length === 3 ? 1000 : 100);
      result.push({
        time: min * 60 + sec + ms,
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
  const [queue, setQueue] = useState<Song[]>([]);
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
  const [adminTab, setAdminTab] = useState<'settings' | 'songs' | 'members' | 'transactions'>('settings');
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);
  
  const [member, setMember] = useState<Member | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings>({ 
    wechat_id: '',
    wechat_qr: '',
    alipay_qr: ''
  });
  
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [txIdLast4, setTxIdLast4] = useState('');
  
  // Player Controls
  const [pitch, setPitch] = useState(0); // -6 to +6
  const [volume, setVolume] = useState(80);
  const [fontScale, setFontScale] = useState(1.0);
  const [isOriginal, setIsOriginal] = useState(false);
  const [fontSize, setFontSize] = useState(24); // base font size
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [savedTime, setSavedTime] = useState(0);
  const [isDraggingLyrics, setIsDraggingLyrics] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Pitch Shifting Refs
  const pitchShiftRef = useRef<any>(null);
  const vocalsPitchShiftRef = useRef<any>(null);
  const audioSourceRef = useRef<any>(null);
  const vocalsSourceRef = useRef<any>(null);
  const isToneStarted = useRef(false);
  
  const videoRef = useRef<HTMLAudioElement>(null);
  const vocalsRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const handleReplay = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
    if (vocalsRef.current) {
      vocalsRef.current.currentTime = 0;
      vocalsRef.current.play().catch(() => {});
    }
  };

  const togglePlay = async () => {
    if (!videoRef.current) return;
    
    // Start Tone on first interaction
    if (!isToneStarted.current) {
      await Tone.start();
      isToneStarted.current = true;
    }

    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      vocalsRef.current?.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      vocalsRef.current?.pause();
      setIsPlaying(false);
    }
  };

  // Lyrics Drag to Seek
  const handleLyricsMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!currentSong || lyrics.length === 0) return;
    setIsDraggingLyrics(true);
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragStartY(y);
    setDragOffset(0);
  };

  const handleLyricsMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDraggingLyrics) return;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragOffset(y - dragStartY);
  };

  const handleLyricsMouseUp = () => {
    if (!isDraggingLyrics) return;
    setIsDraggingLyrics(false);
    
    if (Math.abs(dragOffset) > 20 && videoRef.current) {
      // Calculate how many lines we moved
      const linesMoved = Math.round(dragOffset / 42);
      const newIndex = Math.max(0, Math.min(lyrics.length - 1, currentLyricIndex - linesMoved));
      const newTime = lyrics[newIndex].time;
      videoRef.current.currentTime = newTime;
      if (vocalsRef.current) vocalsRef.current.currentTime = newTime;
    }
    setDragOffset(0);
  };

  // Handle track switching with volume
  const toggleOriginal = () => {
    setIsOriginal(!isOriginal);
  };

  // Update volumes when isOriginal or volume changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100;
    }
    if (vocalsRef.current) {
      vocalsRef.current.volume = isOriginal ? volume / 100 : 0;
    }
  }, [isOriginal, volume]);

  // Restore time when track changes
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      if (savedTime > 0) {
        videoRef.current.currentTime = savedTime;
      }
      if (currentSong) {
        videoRef.current.play().catch(() => {});
      }
    }
    if (vocalsRef.current) {
      if (savedTime > 0) {
        vocalsRef.current.currentTime = savedTime;
      }
      if (currentSong) {
        vocalsRef.current.play().catch(() => {});
      }
    }
    if (savedTime > 0) setSavedTime(0);
  };

  // Tone.js Pitch Shift Setup
  useEffect(() => {
    const setupTone = async () => {
      if (!videoRef.current) return;
      
      const audioCtx = Tone.getContext().rawContext as AudioContext;
      
      // Instrumental
      if (!audioSourceRef.current && videoRef.current) {
        try {
          audioSourceRef.current = audioCtx.createMediaElementSource(videoRef.current);
          pitchShiftRef.current = new Tone.PitchShift(pitch);
          pitchShiftRef.current.wet.value = pitch === 0 ? 0 : 1;
          Tone.connect(audioSourceRef.current, pitchShiftRef.current);
          pitchShiftRef.current.toDestination();
        } catch (e) {
          console.warn("Audio source already created or context error", e);
        }
      }

      // Vocals
      if (!vocalsSourceRef.current && vocalsRef.current) {
        try {
          vocalsSourceRef.current = audioCtx.createMediaElementSource(vocalsRef.current);
          vocalsPitchShiftRef.current = new Tone.PitchShift(pitch);
          vocalsPitchShiftRef.current.wet.value = pitch === 0 ? 0 : 1;
          Tone.connect(vocalsSourceRef.current, vocalsPitchShiftRef.current);
          vocalsPitchShiftRef.current.toDestination();
        } catch (e) {
          console.warn("Vocals source already created or context error", e);
        }
      }
    };

    if (currentSong) {
      setupTone();
    }
  }, [currentSong]);

  // Update pitch when state changes
  useEffect(() => {
    if (pitchShiftRef.current) {
      pitchShiftRef.current.pitch = pitch;
      pitchShiftRef.current.wet.value = pitch === 0 ? 0 : 1;
    }
    if (vocalsPitchShiftRef.current) {
      vocalsPitchShiftRef.current.pitch = pitch;
      vocalsPitchShiftRef.current.wet.value = pitch === 0 ? 0 : 1;
    }
  }, [pitch]);

  // Measure container dimensions
  useEffect(() => {
    if (lyricsContainerRef.current) {
      setContainerHeight(lyricsContainerRef.current.offsetHeight);
      setContainerWidth(lyricsContainerRef.current.offsetWidth);
    }
    const handleResize = () => {
      if (lyricsContainerRef.current) {
        setContainerHeight(lyricsContainerRef.current.offsetHeight);
        setContainerWidth(lyricsContainerRef.current.offsetWidth);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-adjust base font size based on width
  useEffect(() => {
    if (containerWidth > 0) {
      // Scale font size between 18 and 32 depending on width
      const newSize = Math.max(18, Math.min(32, containerWidth / 30));
      setFontSize(newSize);
    }
  }, [containerWidth]);

  // Trial check
  const isTrialExpired = useMemo(() => {
    if (!member) return false;
    if (member.level !== 'guest') return false;
    const created = new Date(member.created_at).getTime();
    const now = Date.now();
    return (now - created) > 24 * 60 * 60 * 1000;
  }, [member]);

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
    
    if (phone) {
      const favRes = await fetch(`/api/favorites?phone=${phone}`);
      const favData = await favRes.json();
      setFavorites(favData);
    }
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

  const handleActivate = async (level: 'monthly' | 'yearly') => {
    if (!member) return;
    if (!txIdLast4 || txIdLast4.length !== 4) {
      alert('请输入支付单号后4位以供核对');
      return;
    }
    try {
      const res = await fetch('/api/member/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone: member.phone, 
          level, 
          method: payMethod,
          tx_id_last4: txIdLast4
        })
      });
      const data = await res.json();
      if (data.success) {
        setMember(data.member);
        setTxIdLast4('');
        alert('会员已成功开通！请等待管理员核对账单。');
        fetchSongs(member.phone);
      } else {
        alert(data.message || '开通失败，请联系客服');
      }
    } catch (e) {
      console.error(e);
      alert('服务器连接失败');
    }
  };

  const handleAdminLogin = async () => {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAdminAuthenticated(true);
        sessionStorage.setItem('ktv_admin_auth', 'true');
      } else {
        alert(data.message || '管理员密码错误');
      }
    } catch (e) {
      console.error(e);
      alert('无法连接到服务器，请检查网络或稍后再试');
    }
  };

  const fetchAllMembers = async () => {
    const res = await fetch('/api/admin/members');
    const data = await res.json();
    setAllMembers(data);
  };

  const fetchTransactions = async () => {
    const res = await fetch('/api/admin/transactions');
    const data = await res.json();
    setAllTransactions(data);
  };

  const auditTransaction = async (tx_id: number, status: 'verified' | 'invalid', phone: string) => {
    const res = await fetch('/api/admin/transactions/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_id, status, phone })
    });
    if (res.ok) {
      fetchTransactions();
      if (member?.phone === phone) {
        handleRegister(phone);
      }
    }
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
      fetchTransactions();
      fetchAdminFiles();
    }
  }, [isAdminAuthenticated, isAdminModalOpen]);

  const handleNext = () => {
    if (isTrialExpired) {
      setIsMemberModalOpen(true);
      return;
    }
    if (queue.length > 0) {
      const next = queue[0];
      setQueue(prev => prev.slice(1));
      setCurrentSong(next);
    } else {
      setCurrentSong(null);
    }
  };

  // Load lyrics when song changes
  useEffect(() => {
    if (currentSong) {
      fetch(currentSong.lrcUrl)
        .then(async res => {
          const buffer = await res.arrayBuffer();
          // Try to decode as UTF-8 first
          let text = new TextDecoder('utf-8').decode(buffer);
          // If it contains replacement characters, it might be GBK
          if (text.includes('\uFFFD')) {
            text = new TextDecoder('gbk').decode(buffer);
          }
          return text;
        })
        .then(text => setLyrics(parseLrc(text)))
        .catch(() => setLyrics([]));
    }
  }, [currentSong]);

  // Handle video time update
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      setIsPlaying(!videoRef.current.paused);
      
      // Sync vocals track if it drifts
      if (vocalsRef.current && Math.abs(vocalsRef.current.currentTime - videoRef.current.currentTime) > 0.1) {
        vocalsRef.current.currentTime = videoRef.current.currentTime;
      }
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, key: 'wechat_qr' | 'alipay_qr') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      saveSettings({ [key]: base64 });
    };
    reader.readAsDataURL(file);
  };

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [adminFiles, setAdminFiles] = useState<{name: string, size: number, mtime: string}[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [filePage, setFilePage] = useState(0);

  const fetchAdminFiles = async () => {
    try {
      const res = await fetch('/api/admin/files');
      const data = await res.json();
      setAdminFiles(data.sort((a: any, b: any) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()));
    } catch (err) {
      console.error(err);
    }
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{type: 'song' | 'files', title?: string, filenames?: string[]}>({type: 'song'});
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const deleteFiles = async (filenames: string[]) => {
    if (!isAdminAuthenticated) {
      alert('请先登录管理员账号');
      return;
    }
    setIsDeleting(true);
    console.log('Attempting to delete files:', filenames);
    try {
      const res = await fetch('/api/admin/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames })
      });
      const data = await res.json();
      if (res.ok) {
        alert('删除成功');
        fetchAdminFiles();
        setSelectedFiles([]);
        fetchSongs(member?.phone || '');
      } else {
        alert('删除失败: ' + (data.message || '未知错误'));
      }
    } catch (err) {
      alert('删除失败，请检查网络连接');
    } finally {
      setIsDeleting(false);
      setIsDeleteConfirmOpen(false);
    }
  };

  const deleteSong = async (title: string) => {
    if (!isAdminAuthenticated) {
      alert('请先登录管理员账号');
      return;
    }
    setIsDeleting(true);
    console.log('Attempting to delete song:', title);
    try {
      const res = await fetch('/api/admin/songs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      const data = await res.json();
      if (res.ok) {
        alert('歌曲已删除');
        fetchSongs(member?.phone || '');
        fetchAdminFiles();
        if (currentSong?.title === title) {
          setCurrentSong(null);
        }
      } else {
        alert('删除失败: ' + (data.message || '未知错误'));
      }
    } catch (err) {
      alert('删除失败，请检查网络连接');
    } finally {
      setIsDeleting(false);
      setIsDeleteConfirmOpen(false);
    }
  };

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles = (Array.from(files) as File[]).filter(file => 
      file.name.endsWith('.mp3') || file.name.endsWith('.m4a') || file.name.endsWith('.lrc') || file.name.endsWith('.jpg') || file.name.endsWith('.png')
    );

    if (validFiles.length === 0) {
      alert('仅支持 .mp3, .m4a, .lrc, .jpg 或 .png 格式');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    let successCount = 0;

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result as string;
          try {
            const res = await fetch('/api/admin/upload-music', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: file.name, data: base64 })
            });
            if (res.ok) successCount++;
          } catch (err) {
            console.error(`Failed to upload ${file.name}`, err);
          }
          setUploadProgress(Math.round(((i + 1) / validFiles.length) * 100));
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }

    setIsUploading(false);
    setUploadProgress(0);
    alert(`成功上传 ${successCount} 个文件`);
    fetchAdminFiles();
    fetchSongs(member?.phone || '');
  };

  const toggleFavorite = async (songId: number) => {
    if (!member) {
      setIsMemberModalOpen(true);
      return;
    }
    const res = await fetch('/api/favorites/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: member.phone, song_id: songId })
    });
    const data = await res.json();
    if (data.favorited) {
      setFavorites(prev => [...prev, songId]);
    } else {
      setFavorites(prev => prev.filter(id => id !== songId));
    }
  };

  const favoriteSongs = useMemo(() => {
    return favorites.map(id => songs.find(s => s.id === id)).filter(Boolean) as Song[];
  }, [favorites, songs]);

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-[100dvh] bg-neutral-950 text-neutral-100 font-sans overflow-hidden select-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
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
                    <div 
                      key={song.id}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 group"
                    >
                      <button 
                        onClick={() => {
                          setCurrentSong(song);
                          setSearchQuery('');
                        }}
                        className="flex-1 text-left"
                      >
                        <div className="font-medium">{song.title}</div>
                        <div className="text-[10px] text-neutral-500">{song.artist}</div>
                      </button>
                      <div className="flex items-center gap-3">
                        {isAdminAuthenticated && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({type: 'song', title: song.title});
                              setIsDeleteConfirmOpen(true);
                            }}
                            className="p-2 hover:bg-rose-500/20 rounded-full transition-colors text-rose-500"
                            title="管理员删除"
                          >
                            <X size={16} />
                          </button>
                        )}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(song.id);
                          }}
                          className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                          <Heart 
                            size={16} 
                            className={favorites.includes(song.id) ? 'text-rose-500' : 'text-neutral-500'} 
                            fill={favorites.includes(song.id) ? "currentColor" : "none"}
                          />
                        </button>
                        <Music size={16} className="text-neutral-600" />
                      </div>
                    </div>
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
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsAdminModalOpen(true)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-neutral-400 hover:text-white"
          >
            <Settings size={22} />
          </button>
        </div>
      </header>

      {/* --- Middle: Audio & Lyrics Area --- */}
      <main className="flex-1 relative flex flex-col items-center justify-center overflow-hidden bg-black">
        {/* Audio Player */}
        <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center">
          {currentSong ? (
            <>
              <audio 
                ref={videoRef}
                key={`${currentSong.id}-instrumental`}
                src={currentSong.url}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleNext}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => vocalsRef.current?.play().catch(() => {})}
                onPause={() => vocalsRef.current?.pause()}
                autoPlay
                crossOrigin="anonymous"
              />
              {currentSong.vocalsUrl && (
                <audio 
                  ref={vocalsRef}
                  key={`${currentSong.id}-vocals`}
                  src={currentSong.vocalsUrl}
                  onLoadedMetadata={handleLoadedMetadata}
                  muted={!isOriginal}
                  crossOrigin="anonymous"
                />
              )}
              {currentSong.singerImg && (
                <div className="absolute inset-0 w-full h-full overflow-hidden">
                  <img 
                    src={currentSong.singerImg} 
                    alt="Singer" 
                    className="w-full h-full object-cover opacity-80"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 text-neutral-500">
              <Mic2 size={64} strokeWidth={1} />
              <p className="text-lg">请在上方搜索并点播歌曲</p>
            </div>
          )}
        </div>

        {/* Lyrics Area */}
        <div 
          ref={lyricsContainerRef}
          className="absolute inset-0 flex flex-col items-center justify-start px-8 overflow-hidden cursor-pointer pointer-events-auto"
          onMouseDown={handleLyricsMouseDown}
          onMouseMove={handleLyricsMouseMove}
          onMouseUp={handleLyricsMouseUp}
          onMouseLeave={handleLyricsMouseUp}
          onTouchStart={handleLyricsMouseDown}
          onTouchMove={handleLyricsMouseMove}
          onTouchEnd={handleLyricsMouseUp}
          onClick={(e) => {
            // Only toggle play if not dragging
            if (!isDraggingLyrics && Math.abs(dragOffset) < 5) {
              togglePlay();
            }
          }}
        >
          {/* Singer Background Image for Lyrics Window */}
          {currentSong?.singerImg && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <img 
                src={currentSong.singerImg} 
                alt="Singer Background" 
                className="w-full h-full object-cover opacity-10"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/80" />
            </div>
          )}

          {/* Font Size Controls */}
          <div className="absolute top-4 left-4 z-40 flex flex-col gap-2 pointer-events-auto">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setFontScale(s => Math.min(s + 0.1, 2.0));
              }}
              className="p-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
              title="放大歌词"
            >
              <Plus size={20} />
            </button>
            <div className="flex items-center justify-center text-[10px] font-bold text-white/40">
              <Type size={12} className="mr-1" />
              {Math.round(fontScale * 100)}%
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setFontScale(s => Math.max(s - 0.1, 0.5));
              }}
              className="p-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
              title="缩小歌词"
            >
              <Minus size={20} />
            </button>
          </div>

          <div className="w-full max-w-4xl h-full flex flex-col items-center overflow-hidden relative">
            <motion.div 
              animate={{ y: -currentLyricIndex * 42 + (containerHeight / 2) - 42 + dragOffset }}
              transition={isDraggingLyrics ? { type: "tween", duration: 0 } : { type: "spring", damping: 25, stiffness: 120 }}
              className="absolute top-0 left-0 right-0 flex flex-col items-center gap-0 py-20"
            >
              {lyrics.map((line, index) => {
                // Auto font size calculation: base size reduced if line is long
                const lineLength = line.text.length;
                const scaleFactor = lineLength > 20 ? Math.max(0.5, 20 / lineLength) : 1;
                const currentLineFontSize = (index === currentLyricIndex ? fontSize * scaleFactor : fontSize * 0.8 * scaleFactor) * fontScale;

                return (
                  <div 
                    key={index}
                    style={{ fontSize: `${currentLineFontSize}px`, height: '42px' }}
                    className={`transition-all duration-300 font-bold text-center flex items-center justify-center leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] w-full px-4 ${
                      index === currentLyricIndex ? 'text-white opacity-100 scale-110' : 'text-neutral-500 opacity-70'
                    }`}
                  >
                    {line.text}
                  </div>
                );
              })}
              {lyrics.length === 0 && (
                <div className="text-neutral-600 italic mt-20">暂无歌词</div>
              )}
            </motion.div>
          </div>

          {/* Favorite Button (Bottom of Lyrics Area) */}
          {currentSong && (
            <div className="absolute bottom-6 right-6 z-30 pointer-events-auto">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(currentSong.id);
                }}
                className="p-4 bg-black/60 backdrop-blur-md border border-white/10 rounded-full hover:scale-110 transition-transform shadow-xl group"
                title="收藏伴奏"
              >
                <Heart 
                  size={28} 
                  className={`transition-colors ${favorites.includes(currentSong.id) ? 'text-rose-500' : 'text-white/40 group-hover:text-white'}`}
                  fill={favorites.includes(currentSong.id) ? "currentColor" : "none"} 
                />
              </button>
            </div>
          )}
        </div>
      </main>

      {/* --- Bottom Menu Bar: Controls --- */}
      <footer className="bg-neutral-900 border-t border-white/5 px-4 py-3 z-50">
        <div className="max-w-screen-xl mx-auto flex flex-col gap-3">
          {/* Row 1 */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-1">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsFavoritesModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 text-neutral-400 hover:bg-white/10 transition-all whitespace-nowrap"
              >
                <ListMusic size={16} />
                <span className="text-xs font-bold">收藏列表</span>
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* Pitch Control */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold hidden xs:block">音调</span>
                <div className="flex items-center bg-white/5 rounded-lg p-0.5 h-10">
                  <button 
                    onClick={() => setPitch(p => Math.max(p - 1, -6))}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors text-neutral-400"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <span className="w-6 text-center font-mono font-bold text-indigo-400 text-xs">
                    {pitch > 0 ? `+${pitch}` : pitch}
                  </span>
                  <button 
                    onClick={() => setPitch(p => Math.min(p + 1, 6))}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors text-neutral-400"
                  >
                    <ChevronUp size={16} />
                  </button>
                </div>
              </div>

              {/* Volume Control */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold hidden xs:block">音量</span>
                <div className="flex items-center bg-white/5 rounded-lg p-0.5 h-10">
                  <button 
                    onClick={() => {
                      const v = Math.max(volume - 5, 0);
                      setVolume(v);
                      if (videoRef.current) videoRef.current.volume = v / 100;
                    }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors text-neutral-400"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-8 text-center font-mono font-bold text-indigo-400 text-xs">
                    {volume}
                  </span>
                  <button 
                    onClick={() => {
                      const v = Math.min(volume + 5, 100);
                      setVolume(v);
                      if (videoRef.current) videoRef.current.volume = v / 100;
                    }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors text-neutral-400"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button 
                onClick={togglePlay}
                disabled={!currentSong}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-all disabled:opacity-30 shadow-lg shadow-indigo-500/20"
              >
                {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                <span className="text-xs font-bold">{isPlaying ? '暂停' : '播放'}</span>
              </button>
              <button 
                onClick={handleReplay}
                disabled={!currentSong}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-all disabled:opacity-30"
              >
                <Monitor size={16} />
                <span className="text-xs font-bold">重唱</span>
              </button>
              <button 
                onClick={handleNext}
                disabled={!currentSong}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 text-neutral-400 hover:bg-white/10 transition-all disabled:opacity-30"
              >
                <Music size={16} />
                <span className="text-xs font-bold">切歌</span>
              </button>
            </div>

            <div className="flex items-center bg-white/5 rounded-lg p-0.5 h-10">
              <button 
                onClick={() => {
                  if (isOriginal) toggleOriginal();
                }}
                className={`px-3 h-9 rounded-md text-[10px] font-bold transition-all ${
                  !isOriginal ? 'bg-indigo-500 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                伴奏
              </button>
              <button 
                onClick={() => {
                  if (!isOriginal) toggleOriginal();
                }}
                className={`px-3 h-9 rounded-md text-[10px] font-bold transition-all ${
                  isOriginal ? 'bg-amber-500 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                原唱
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
                <h3 className="text-lg font-bold">欢迎使用 JINAGEOK Pro</h3>
                {isTrialExpired ? (
                  <p className="text-sm text-rose-500 font-bold">试用期已到期，请注册会员继续使用</p>
                ) : (
                  <p className="text-sm text-neutral-400">输入手机号即可快速注册/登录</p>
                )}
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
                  注册/登陆
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
                  </div>

                  <div className="flex p-1 bg-white/5 rounded-xl">
                    <button 
                      onClick={() => setPayMethod('wechat')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                        payMethod === 'wechat' ? 'bg-emerald-500 text-white' : 'text-neutral-500'
                      }`}
                    >
                      微信支付
                    </button>
                    <button 
                      onClick={() => setPayMethod('alipay')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                        payMethod === 'alipay' ? 'bg-blue-500 text-white' : 'text-neutral-500'
                      }`}
                    >
                      支付宝
                    </button>
                  </div>

                  <div className="flex flex-col items-center gap-4 p-6 bg-white/5 rounded-2xl border border-white/5">
                    <div className="w-48 h-48 bg-white rounded-xl p-2 flex items-center justify-center overflow-hidden">
                      {payMethod === 'wechat' ? (
                        appSettings.wechat_qr ? (
                          <img src={appSettings.wechat_qr} alt="WeChat QR" className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-neutral-400 text-[10px] text-center">管理员未上传微信收款码</div>
                        )
                      ) : (
                        appSettings.alipay_qr ? (
                          <img src={appSettings.alipay_qr} alt="Alipay QR" className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-neutral-400 text-[10px] text-center">管理员未上传支付宝收款码</div>
                        )
                      )}
                    </div>
                    <div className="w-full space-y-2">
                      <p className="text-[10px] text-neutral-500 text-center">
                        请使用手机扫码支付，支付完成后输入单号后4位开通
                      </p>
                      <input 
                        type="text"
                        maxLength={4}
                        placeholder="支付单号后4位 (必填)"
                        value={txIdLast4}
                        onChange={(e) => setTxIdLast4(e.target.value.replace(/\D/g, ''))}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-center font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => handleActivate('monthly')}
                      className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 text-center transition-all group"
                    >
                      <div className="text-lg font-bold group-hover:text-amber-500 transition-colors">¥10</div>
                      <div className="text-[10px] text-neutral-500">支付后点此开通月度</div>
                    </button>
                    <button 
                      onClick={() => handleActivate('yearly')}
                      className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 text-center transition-all group"
                    >
                      <div className="text-lg font-bold group-hover:text-amber-500 transition-colors">¥100</div>
                      <div className="text-[10px] text-neutral-500">支付后点此开通年度</div>
                    </button>
                  </div>

                  <div className="pt-2">
                    <div className="text-xs text-neutral-500 mb-2">手动开通请联系客服：</div>
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

      {/* Favorites Modal */}
      <Modal 
        isOpen={isFavoritesModalOpen} 
        onClose={() => setIsFavoritesModalOpen(false)}
        title="我的收藏伴奏"
      >
        <div className="space-y-2">
          {favoriteSongs.length > 0 ? (
            favoriteSongs.map(song => (
              <button 
                key={song.id}
                onClick={() => {
                  setCurrentSong(song);
                  setIsFavoritesModalOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-colors border border-white/5"
              >
                <div className="text-left">
                  <div className="font-medium">{song.title}</div>
                  <div className="text-xs text-neutral-400">{song.artist}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-neutral-500">点击播放</span>
                  <Music size={16} className="text-indigo-400" />
                </div>
              </button>
            ))
          ) : (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto text-neutral-600">
                <Heart size={32} />
              </div>
              <p className="text-sm text-neutral-500">暂无收藏伴奏</p>
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
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${
                  adminTab === 'settings' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                系统设置
              </button>
              <button 
                onClick={() => setAdminTab('songs')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${
                  adminTab === 'songs' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                歌曲管理
              </button>
              <button 
                onClick={() => setAdminTab('members')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${
                  adminTab === 'members' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                会员管理
              </button>
              <button 
                onClick={() => setAdminTab('transactions')}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${
                  adminTab === 'transactions' ? 'bg-neutral-700 text-white' : 'text-neutral-500'
                }`}
              >
                财务审计
              </button>
            </div>

            {adminTab === 'settings' ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase">微信收款码</label>
                    <div className="relative group aspect-square bg-white/5 rounded-xl border border-white/10 overflow-hidden flex items-center justify-center">
                      {appSettings.wechat_qr ? (
                        <img src={appSettings.wechat_qr} alt="WeChat QR" className="w-full h-full object-contain" />
                      ) : (
                        <Plus className="text-neutral-600" />
                      )}
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={(e) => handleFileUpload(e, 'wechat_qr')}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-500 uppercase">支付宝收款码</label>
                    <div className="relative group aspect-square bg-white/5 rounded-xl border border-white/10 overflow-hidden flex items-center justify-center">
                      {appSettings.alipay_qr ? (
                        <img src={appSettings.alipay_qr} alt="Alipay QR" className="w-full h-full object-contain" />
                      ) : (
                        <Plus className="text-neutral-600" />
                      )}
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={(e) => handleFileUpload(e, 'alipay_qr')}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
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
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-2">
                    批量上传音乐、歌词与封面 (.mp3 / .m4a / .lrc / .jpg / .png)
                  </label>
                  <div className="relative group bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex flex-col items-center justify-center gap-2 transition-all hover:bg-indigo-500/20">
                    {isUploading ? (
                      <div className="w-full space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-bold text-indigo-400">
                          <span>正在批量上传...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress}%` }}
                            className="h-full bg-indigo-500"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <Plus className="text-indigo-400" />
                        <span className="text-xs font-bold text-indigo-400">点击选择多个文件上传</span>
                      </>
                    )}
                    <input 
                      type="file" 
                      accept=".mp3,.m4a,.aac,.lrc,.jpg,.png"
                      multiple
                      disabled={isUploading}
                      onChange={handleMusicUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* File List Management */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-neutral-500 uppercase">文件管理 ({adminFiles.length})</label>
                    {selectedFiles.length > 0 && (
                      <button 
                        onClick={() => {
                          setDeleteTarget({type: 'files', filenames: selectedFiles});
                          setIsDeleteConfirmOpen(true);
                        }}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-400 flex items-center gap-1"
                      >
                        <X size={12} />
                        批量删除 ({selectedFiles.length})
                      </button>
                    )}
                  </div>
                  
                  <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <div className="max-h-[320px] overflow-y-auto">
                      {adminFiles.slice(filePage * 10, (filePage + 1) * 10).map((file) => (
                        <div key={file.name} className="flex items-center justify-between px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <input 
                              type="checkbox" 
                              checked={selectedFiles.includes(file.name)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedFiles(prev => [...prev, file.name]);
                                else setSelectedFiles(prev => prev.filter(f => f !== file.name));
                              }}
                              className="w-4 h-4 rounded border-white/10 bg-white/5 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-medium truncate text-neutral-200">{file.name}</span>
                              <span className="text-[10px] text-neutral-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({type: 'files', filenames: [file.name]});
                              setIsDeleteConfirmOpen(true);
                            }}
                            className="p-2 text-neutral-500 hover:text-rose-500 transition-colors"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      {adminFiles.length === 0 && (
                        <div className="py-8 text-center text-neutral-500 text-xs">暂无文件</div>
                      )}
                    </div>
                    
                    {adminFiles.length > 10 && (
                      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-t border-white/5">
                        <button 
                          disabled={filePage === 0}
                          onClick={() => setFilePage(p => p - 1)}
                          className="p-1 text-neutral-400 disabled:opacity-30"
                        >
                          <ChevronDown className="rotate-90" size={16} />
                        </button>
                        <span className="text-[10px] font-bold text-neutral-500">
                          第 {filePage + 1} / {Math.ceil(adminFiles.length / 10)} 页
                        </span>
                        <button 
                          disabled={(filePage + 1) * 10 >= adminFiles.length}
                          onClick={() => setFilePage(p => p + 1)}
                          className="p-1 text-neutral-400 disabled:opacity-30"
                        >
                          <ChevronDown className="-rotate-90" size={16} />
                        </button>
                      </div>
                    )}
                  </div>
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
            ) : adminTab === 'songs' ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-neutral-500 uppercase">歌曲列表 ({songs.length})</label>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <div className="max-h-[400px] overflow-y-auto">
                    {songs.map((song) => (
                      <div key={song.id} className="flex items-center justify-between px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate text-neutral-200">{song.title}</span>
                          <span className="text-[10px] text-neutral-500">{song.artist}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDeleteTarget({type: 'song', title: song.title});
                            setIsDeleteConfirmOpen(true);
                          }}
                          className="p-2 text-neutral-500 hover:text-rose-500 transition-colors"
                          title="删除歌曲及其所有文件"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                    {songs.length === 0 && (
                      <div className="py-12 text-center text-neutral-500 text-xs italic">暂无歌曲</div>
                    )}
                  </div>
                </div>
              </div>
            ) : adminTab === 'members' ? (
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
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                {allTransactions.length > 0 ? (
                  allTransactions.map(tx => (
                    <div key={tx.id} className="p-4 bg-white/5 border border-white/5 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm">{tx.phone}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          tx.status === 'verified' ? 'bg-emerald-500/20 text-emerald-500' :
                          tx.status === 'invalid' ? 'bg-rose-500/20 text-rose-500' :
                          'bg-amber-500/20 text-amber-500'
                        }`}>
                          {tx.status === 'verified' ? '已核实' : tx.status === 'invalid' ? '虚假交易' : '待核实'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-neutral-400">
                        <span>{tx.method === 'wechat' ? '微信' : '支付宝'} · ¥{tx.amount} ({tx.level === 'monthly' ? '月' : '年'})</span>
                        <span className="font-mono">尾号: {tx.tx_id_last4}</span>
                      </div>
                      <div className="text-[10px] text-neutral-600">{new Date(tx.created_at).toLocaleString()}</div>
                      
                      {tx.status === 'pending_audit' && (
                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={() => auditTransaction(tx.id, 'verified', tx.phone)}
                            className="flex-1 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg text-[10px] font-bold transition-all"
                          >
                            确认收款
                          </button>
                          <button 
                            onClick={() => auditTransaction(tx.id, 'invalid', tx.phone)}
                            className="flex-1 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-lg text-[10px] font-bold transition-all"
                          >
                            标记虚假
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-neutral-500 text-sm">暂无交易流水</div>
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
      {/* Delete Confirmation Modal */}
      <Modal 
        isOpen={isDeleteConfirmOpen} 
        onClose={() => !isDeleting && setIsDeleteConfirmOpen(false)}
        title="确认删除"
      >
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto text-rose-500">
              <X size={32} />
            </div>
            <h3 className="text-lg font-bold">确定要执行删除操作吗？</h3>
            <p className="text-sm text-neutral-400">
              {deleteTarget.type === 'song' 
                ? `即将删除歌曲 "${deleteTarget.title}" 及其所有关联文件。` 
                : `即将删除选中的 ${deleteTarget.filenames?.length} 个文件。`}
            </p>
            <p className="text-xs text-rose-500 font-bold">此操作不可撤销！</p>
          </div>
          <div className="flex gap-3">
            <button 
              disabled={isDeleting}
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button 
              disabled={isDeleting}
              onClick={() => {
                if (deleteTarget.type === 'song' && deleteTarget.title) {
                  deleteSong(deleteTarget.title);
                } else if (deleteTarget.type === 'files' && deleteTarget.filenames) {
                  deleteFiles(deleteTarget.filenames);
                }
              }}
              className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isDeleting && <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
              {isDeleting ? '正在删除...' : '确认删除'}
            </button>
          </div>
        </div>
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
