import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, TextInput, Button, FlatList, TouchableOpacity, StyleSheet, Image, ScrollView, Modal, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";

// غيّر هذا حسب جهازك:
const API_BASE = Platform.select({
  ios: "http://localhost:4000",
  android: "http://10.0.2.2:4000",
  default: "http://localhost:4000"
});

// Helpers
async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

async function presignedUpload({ token, type = "image", fileUri, ext = "jpg" }) {
  const p = await api(`/upload/presign?type=${encodeURIComponent(type)}&ext=${encodeURIComponent(ext)}`, { token });
  const up = await FileSystem.uploadAsync(p.url, fileUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": p.contentType }
  });
  if (up.status >= 200 && up.status < 300) return p.publicUrl;
  throw new Error("upload_failed");
}

export default function App() {
  const [token, setToken] = useState(null);
  useEffect(() => { AsyncStorage.getItem("token").then(setToken); }, []);
  if (!token) return <Auth onAuth={async (t)=>{ await AsyncStorage.setItem("token", t); setToken(t); }} />;
  return <Main token={token} onLogout={async ()=>{ await AsyncStorage.removeItem("token"); setToken(null); }} />;
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    try {
      if (mode === "login") {
        const j = await api("/auth/login", { method: "POST", body: { usernameOrEmail: username || email, password } });
        onAuth(j.token);
      } else {
        const j = await api("/auth/register", { method: "POST", body: { username, email: email || undefined, password } });
        onAuth(j.token);
      }
    } catch(e){ alert(e.message || "تعذر الاتصال"); }
  }

  return (
    <SafeAreaView style={s.container}>
      <Text style={s.title}>قوافي — ادخل حسابك</Text>
      {mode === "register" ? (
        <>
          <TextInput style={s.input} placeholder="اسم المستخدم" value={username} onChangeText={setUsername} />
          <TextInput style={s.input} placeholder="البريد (اختياري)" value={email} onChangeText={setEmail} keyboardType="email-address" />
        </>
      ) : (
        <TextInput style={s.input} placeholder="اسم المستخدم أو البريد" value={username} onChangeText={setUsername} />
      )}
      <TextInput style={s.input} placeholder="كلمة المرور" secureTextEntry value={password} onChangeText={setPassword} />
      <Button title={mode === "login" ? "تسجيل الدخول" : "إنشاء حساب"} onPress={submit} />
      <View style={{ height: 10 }} />
      <Button title={mode === "login" ? "لا تملك حساب؟ سجّل الآن" : "لديك حساب؟ سجّل دخول"} onPress={()=>setMode(mode==="login"?"register":"login")} />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function Main({ token, onLogout }) {
  const [tab, setTab] = useState("feed");
  return (
    <SafeAreaView style={s.container}>
      {tab === "feed" && <Feed token={token} />}
      {tab === "search" && <Search token={token} />}
      {tab === "notifs" && <Notifs token={token} />}
      {tab === "me" && <Me token={token} onLogout={onLogout} />}
      <View style={s.tabs}>
        <TabBtn title="الرئيسية" active={tab==="feed"} onPress={()=>setTab("feed")} />
        <TabBtn title="استكشاف" active={tab==="search"} onPress={()=>setTab("search")} />
        <TabBtn title="إشعارات" active={tab==="notifs"} onPress={()=>setTab("notifs")} />
        <TabBtn title="ملفي" active={tab==="me"} onPress={()=>setTab("me")} />
      </View>
    </SafeAreaView>
  );
}

function TabBtn({ title, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.tab, active && s.tabActive]}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{title}</Text>
    </TouchableOpacity>
  );
}

function Feed({ token }) {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState("");
  const [attachedImage, setAttachedImage] = useState(null);
  const [stories, setStories] = useState([]);
  const [storyModal, setStoryModal] = useState({ visible: false, story: null });

  async function load(reset=false){
    if (loading) return;
    setLoading(true);
    try {
      const url = `${API_BASE}/feed${reset ? "" : (cursor ? "?cursor="+cursor : "")}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json();
      setPosts(reset ? j.items : [...posts, ...j.items]);
      setCursor(j.nextCursor);
    } catch(e){ alert("تعذر تحميل الفيد"); }
    setLoading(false);
  }

  async function loadStories(){
    try { const j = await api("/stories", { token }); setStories(j); } catch {}
  }

  useEffect(()=>{ load(true); loadStories(); }, []);

  async function createPost(){
    if(!content.trim() && !attachedImage) return;
    try {
      let imageUrl;
      if (attachedImage) {
        imageUrl = await presignedUpload({ token, type: "image", fileUri: attachedImage.uri, ext: "jpg" });
      }
      await api("/posts", { method: "POST", token, body: { content, poemType: "FUSHA", imageUrl } });
      setContent(""); setAttachedImage(null);
      load(true);
    } catch(e){ alert(e.message || "خطأ أثناء النشر"); }
  }

  async function pickImage(setter){
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return alert("نحتاج إذن للوصول للصور");
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!r.canceled) setter(r.assets[0]);
  }

  async function addStory() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return alert("نحتاج إذن للوصول للصور");
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (r.canceled) return;
    try {
      const mediaUrl = await presignedUpload({ token, type: "image", fileUri: r.assets[0].uri, ext: "jpg" });
      await api("/stories", { method: "POST", token, body: { mediaUrl, mediaType: "IMAGE" } });
      loadStories();
      alert("تم نشر الستوري ✅");
    } catch(e){ alert("فشل رفع الستوري"); }
  }

  async function toggleLike(postId, liked) {
    try {
      if (liked) await api(`/posts/${postId}/like`, { method: "DELETE", token });
      else await api(`/posts/${postId}/like`, { method: "POST", token });
      setPosts(prev => prev.map(p => p.id===postId ? {
        ...p, liked: !liked, counts: { ...p.counts, likes: p.counts.likes + (liked ? -1 : 1) }
      } : p));
    } catch {}
  }

  const renderItem = ({ item }) => (
    <PostCard item={item} onLike={()=>toggleLike(item.id, item.liked)} token={token} />
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={s.row}>
        <Text style={s.header}>الرئيسية</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="ستوري +" onPress={addStory} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {stories.map(st => (
          <TouchableOpacity key={st.id} style={s.story} onPress={()=>setStoryModal({ visible: true, story: st })}>
            <View style={s.storyCircle}>
              <Text style={{ color: "#fff" }}>{st.author.username.slice(0,1).toUpperCase()}</Text>
            </View>
            <Text style={s.storyName}>@{st.author.username}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.compose}>
        <TextInput style={s.input} placeholder="اكتب بيتك الأول..." value={content} onChangeText={setContent} multiline />
        {attachedImage && <Image source={{ uri: attachedImage.uri }} style={{ width: "100%", height: 160, borderRadius: 8, marginBottom: 8 }} />}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="إرفاق صورة" onPress={()=>pickImage(setAttachedImage)} />
          <Button title="نشر" onPress={createPost} />
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        onEndReached={()=>{ if(cursor) load(); }}
        onEndReachedThreshold={0.5}
        refreshing={loading}
        onRefresh={()=>load(true)}
      />

      <Modal visible={storyModal.visible} transparent animationType="fade" onRequestClose={()=>setStoryModal({ visible:false, story:null })}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            {storyModal.story?.mediaUrl ? (
              <Image source={{ uri: storyModal.story.mediaUrl }} style={{ width: 320, height: 480, borderRadius: 12 }} />
            ) : <Text>Story</Text>}
            <Button title="إغلاق" onPress={()=>setStoryModal({ visible:false, story:null })} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PostCard({ item, onLike, token }) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [cText, setCText] = useState("");

  async function loadComments() {
    try { const j = await api(`/posts/${item.id}/comments`, { token }); setComments(j); } catch {}
  }
  async function sendComment() {
    if (!cText.trim()) return;
    try {
      const c = await api(`/posts/${item.id}/comments`, { method: "POST", token, body: { text: cText } });
      setComments([...comments, c]);
      setCText("");
    } catch {}
  }

  return (
    <View style={s.card}>
      <Text style={s.user}>@{item.author.username}</Text>
      {item.title ? <Text style={s.title2}>{item.title}</Text> : null}
      <Text style={s.content}>{item.content}</Text>
      {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: 200, borderRadius: 8, marginVertical: 8 }} /> : null}
      <View style={s.row}>
        <TouchableOpacity onPress={onLike}>
          <Text style={{ fontSize: 16 }}>{item.liked ? "❤️" : "🤍"} {item.counts.likes}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setShowComments(!showComments); if (!showComments) loadComments(); }}>
          <Text style={{ color: "#2563eb" }}>تعليقات ({item.counts.comments})</Text>
        </TouchableOpacity>
      </View>
      {showComments && (
        <View style={{ marginTop: 8 }}>
          {comments.map(c => (
            <View key={c.id} style={{ paddingVertical: 4 }}>
              <Text style={{ color: "#555" }}>@{c.author?.username || "user"}:</Text>
              <Text>{c.text}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <TextInput value={cText} onChangeText={setCText} placeholder="اكتب تعليقاً..." style={[s.input, { flex: 1, marginBottom: 0 }]} />
            <Button title="إرسال" onPress={sendComment} />
          </View>
        </View>
      )}
    </View>
  );
}

function Search({ token }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);

  async function search() {
    if (!q.trim()) return setUsers([]);
    try { const j = await api(`/users/search?q=${encodeURIComponent(q)}`, { token }); setUsers(j); } catch {}
  }
  useEffect(()=>{ const t = setTimeout(search, 300); return ()=>clearTimeout(t); }, [q]);

  async function toggleFollow(u) {
    try {
      if (u.isFollowing) {
        await api(`/users/${u.id}/follow`, { method: "DELETE", token });
        setUsers(prev => prev.map(x => x.id===u.id ? { ...x, isFollowing: false } : x));
      } else {
        await api(`/users/${u.id}/follow`, { method: "POST", token });
        setUsers(prev => prev.map(x => x.id===u.id ? { ...x, isFollowing: true } : x));
      }
    } catch {}
  }

  return (
    <View style={{ flex: 1 }}>
      <Text style={s.header}>استكشاف</Text>
      <TextInput style={s.input} placeholder="ابحث عن شاعر…" value={q} onChangeText={setQ} />
      <FlatList
        data={users}
        keyExtractor={u=>u.id}
        renderItem={({ item }) => (
          <View style={s.card}>
            <Text style={s.user}>@{item.username}</Text>
            <Button title={item.isFollowing ? "إلغاء المتابعة" : "متابعة"} onPress={()=>toggleFollow(item)} />
          </View>
        )}
      />
    </View>
  );
}

function Notifs({ token }) {
  const [items, setItems] = useState([]);
  async function load(){ try { const j = await api("/notifications", { token }); setItems(j); } catch {} }
  useEffect(()=>{ load(); }, []);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.header}>الإشعارات</Text>
      <FlatList
        data={items}
        keyExtractor={(i)=>i.id}
        renderItem={({ item }) => (
          <View style={s.card}>
            <Text> @{item.actor?.username} — {item.type === "LIKE" ? "أُعجب بمنشورك" : item.type === "COMMENT" ? "علّق على منشورك" : "بدأ بمتابعتك"} </Text>
            <Text style={s.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        )}
      />
    </View>
  );
}

function Me({ token, onLogout }) {
  const [me, setMe] = useState(null);
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [myPosts, setMyPosts] = useState([]);

  async function load(){
    try {
      const m = await api("/me", { token });
      setMe(m); setBio(m?.bio || "");
      const posts = await api(`/users/${m.id}/posts`, { token });
      setMyPosts(posts);
    } catch(e){ alert("تعذر تحميل ملفك"); }
  }
  useEffect(()=>{ load(); }, []);

  async function changeAvatar(){
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return alert("نحتاج إذن للوصول للصور");
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (r.canceled) return;
    try {
      const url = await presignedUpload({ token, type: "image", fileUri: r.assets[0].uri, ext: "jpg" });
      setAvatar({ uri: url });
    } catch { alert("فشل رفع الصورة"); }
  }

  async function saveProfile(){
    try {
      await api("/me", { method: "PATCH", token, body: { bio, avatarUrl: avatar?.uri || me?.avatarUrl || null } });
      alert("تم الحفظ ✅"); load();
    } catch(e){ alert("فشل الحفظ"); }
  }

  if (!me) return <Text>...</Text>;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.row}>
        <Text style={s.header}>ملفي</Text>
        <TouchableOpacity onPress={onLogout}><Text style={s.logout}>تسجيل الخروج</Text></TouchableOpacity>
      </View>
      <View style={s.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: "#e5e7eb", overflow: "hidden", justifyContent: "center", alignItems: "center" }}>
            {avatar?.uri || me.avatarUrl ? <Image source={{ uri: avatar?.uri || me.avatarUrl }} style={{ width: "100%", height: "100%" }} /> : <Text style={{ fontSize: 22 }}>{me.username.slice(0,1).toUpperCase()}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 18 }}>@{me.username}</Text>
          </View>
          <Button title="تغيير الصورة" onPress={changeAvatar} />
        </View>
        <TextInput style={[s.input, { marginTop: 10 }]} placeholder="نبذة عني…" value={bio} onChangeText={setBio} multiline />
        <Button title="حفظ" onPress={saveProfile} />
      </View>

      <Text style={[s.header, { marginTop: 8 }]}>قصائدي</Text>
      <FlatList
        data={myPosts}
        keyExtractor={p=>p.id}
        renderItem={({ item }) => (
          <View style={s.card}>
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: 160, borderRadius: 8, marginBottom: 8 }} /> : null}
            <Text style={s.content}>{item.content}</Text>
            <Text style={s.meta}>❤️ {item.counts.likes} • 💬 {item.counts.comments}</Text>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f8fafc" },
  title: { fontSize: 20, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: "#fff" },
  header: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  logout: { color: "#e11d48", marginLeft: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  compose: { marginBottom: 8 },
  card: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: "#fff" },
  user: { color: "#555", marginBottom: 6 },
  title2: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  content: { fontSize: 16, lineHeight: 22 },
  meta: { color: "#888", marginTop: 6 },
  tabs: { flexDirection: "row", gap: 8, justifyContent: "space-between", marginTop: 8 },
  tab: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", backgroundColor: "#fff" },
  tabActive: { backgroundColor: "#0ea5e9", borderColor: "#0ea5e9" },
  tabText: { color: "#0f172a", fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  story: { alignItems: "center", marginRight: 12 },
  storyCircle: { width: 56, height: 56, borderRadius: 999, backgroundColor: "#0ea5e9", justifyContent: "center", alignItems: "center", marginBottom: 4 },
  storyName: { fontSize: 12, color: "#334155" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,.5)", justifyContent: "center", alignItems: "center" },
  modalCard: { backgroundColor: "#111827", padding: 12, borderRadius: 12, alignItems: "center", gap: 8 }
});
