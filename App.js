import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, TextInput, Button, FlatList, TouchableOpacity, StyleSheet, Image, ScrollView, Modal, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";

// الرابط الدائم الجديد للسيرفر:
const API_BASE = "https://qawafi-server.onrender.com";

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
      {item.imageUrl && <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: 200, borderRadius: 8, marginTop: 8 }} />}
      <View style={s.actions}>
        <TouchableOpacity onPress={onLike}><Text style={{ color: item.liked ? "red" : "#000" }}>❤️ {item.counts.likes}</Text></TouchableOpacity>
        <TouchableOpacity onPress={()=>{ setShowComments(!showComments); if(!showComments) loadComments(); }}><Text>💬 {item.counts.comments}</Text></TouchableOpacity>
      </View>
      {showComments && (
        <View style={s.comments}>
          {comments.map(c => (
            <Text key={c.id} style={s.comment}><Text style={{ fontWeight: "bold" }}>{c.author.username}:</Text> {c.text}</Text>
          ))}
          <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
            <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="أضف تعليقاً..." value={cText} onChangeText={setCText} />
            <Button title="إرسال" onPress={sendComment} />
          </View>
        </View>
      )}
    </View>
  );
}

function Search({ token }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  async function doSearch() {
    try { const j = await api(`/users/search?q=${encodeURIComponent(q)}`, { token }); setResults(j); } catch {}
  }
  async function toggleFollow(u) {
    try {
      await api(`/users/${u.id}/follow`, { method: u.isFollowing ? "DELETE" : "POST", token });
      setResults(results.map(x => x.id===u.id ? { ...x, isFollowing: !u.isFollowing } : x));
    } catch {}
  }
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.header}>استكشاف</Text>
      <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
        <TextInput style={[s.input, { flex: 1 }]} placeholder="ابحث عن شعراء..." value={q} onChangeText={setQ} />
        <Button title="بحث" onPress={doSearch} />
      </View>
      <FlatList
        data={results}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <View style={[s.row, { padding: 12, borderBottomWidth: 0.5, borderColor: "#ccc" }]}>
            <Text>@{item.username}</Text>
            <Button title={item.isFollowing ? "إلغاء المتابعة" : "متابعة"} onPress={()=>toggleFollow(item)} />
          </View>
        )}
      />
    </View>
  );
}

function Notifs({ token }) {
  const [list, setList] = useState([]);
  useEffect(()=>{ api("/notifications", { token }).then(setList).catch(()=>{}); }, []);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.header}>الإشعارات</Text>
      <FlatList
        data={list}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderBottomWidth: 0.5, borderColor: "#ccc" }}>
            <Text><Text style={{ fontWeight: "bold" }}>@{item.actor.username}</Text> {item.type === "LIKE" ? "أعجب بمنشورك" : item.type === "FOLLOW" ? "بدأ بمتابعتك" : "علق على منشورك"}</Text>
          </View>
        )}
      />
    </View>
  );
}

function Me({ token, onLogout }) {
  const [me, setMe] = useState(null);
  useEffect(()=>{ api("/me", { token }).then(setMe).catch(()=>{}); }, []);
  if (!me) return null;
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={s.header}>ملفي الشخصي</Text>
      <View style={{ alignItems: "center", marginVertical: 20 }}>
        <View style={[s.storyCircle, { width: 80, height: 80, borderRadius: 40 }]}>
          <Text style={{ fontSize: 32, color: "#fff" }}>{me.username.slice(0,1).toUpperCase()}</Text>
        </View>
        <Text style={{ fontSize: 24, fontWeight: "bold", marginTop: 8 }}>@{me.username}</Text>
        <Text style={{ color: "#666", marginTop: 4 }}>{me.bio || "لا يوجد نبذة شخصية"}</Text>
      </View>
      <Button title="تسجيل الخروج" color="red" onPress={onLogout} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9f9f9", paddingHorizontal: 10 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", marginVertical: 20 },
  header: { fontSize: 22, fontWeight: "bold", marginVertical: 10, paddingHorizontal: 8 },
  input: { borderWidth: 1, borderColor: "#ddd", padding: 12, borderRadius: 8, backgroundColor: "#fff", marginBottom: 12 },
  card: { backgroundColor: "#fff", padding: 12, borderRadius: 10, marginBottom: 12, elevation: 2, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4 },
  user: { fontWeight: "bold", color: "#333", marginBottom: 4 },
  title2: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  content: { fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: "row", gap: 20, marginTop: 10, borderTopWidth: 0.5, borderColor: "#eee", paddingTop: 8 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderColor: "#eee", backgroundColor: "#fff", paddingBottom: Platform.OS === "ios" ? 20 : 0 },
  tab: { flex: 1, alignItems: "center", padding: 12 },
  tabActive: { borderTopWidth: 2, borderColor: "#007AFF" },
  tabText: { color: "#888", fontSize: 12 },
  tabTextActive: { color: "#007AFF", fontWeight: "bold" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 8 },
  compose: { backgroundColor: "#fff", padding: 12, borderRadius: 10, marginBottom: 12, borderBottomWidth: 1, borderColor: "#eee" },
  story: { alignItems: "center", marginRight: 12, width: 70 },
  storyCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#007AFF", justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#fff" },
  storyName: { fontSize: 10, marginTop: 4, color: "#333" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  modalCard: { alignItems: "center", gap: 20 },
  comments: { marginTop: 10, padding: 8, backgroundColor: "#f0f0f0", borderRadius: 8 },
  comment: { fontSize: 13, marginBottom: 4 }
});
