# 🌌 Locmind - Virtual Universe

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Node.js](https://img.shields.io/badge/node->=14.0.0-green.svg) ![Socket.io](https://img.shields.io/badge/socket.io-4.x-orange)

[🇬🇧 English](#-english) | [🇹🇷 Türkçe](#-türkçe)

---

## 🇬🇧 English

**Locmind** is a web-based 2D virtual universe where users can interact with their avatars, chat via real-time voice and video, create private rooms, and collaborate. It runs on HTML5 Canvas and uses WebRTC for peer-to-peer communication.

### 🚀 Key Features

* **🕹️ 2D Virtual World:** Smooth movement mechanics using WASD or mouse click on HTML5 Canvas.
* **🔊 Proximity Voice Chat:** Voice volume changes based on the distance between avatars.
* **📹 Video Call:** Real-time camera sharing via WebRTC (PeerJS).
* **🏠 Room System:**
    * Create private password-protected rooms.
    * Conference areas and door mechanics.
* **⚽ Mini-Games:** A football stadium with physics-based ball mechanics and scoring.
* **🛠️ Collaboration Tools:**
    * **Shared Whiteboard:** Real-time synchronized drawing board.
    * **Shared Notepad:** Collaborative text editor with export (.txt) feature.
    * **Screen Sharing:** Share your screen with other users in the room.
* **🎵 Music Box:** Watch/Listen to YouTube videos synchronized with everyone in the room.
* **💤 AFK System:** Users inactive for **30 minutes** are automatically disconnected.

### 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript, Canvas API
* **Backend:** Node.js, Express.js
* **Real-time Comm:** Socket.io
* **P2P Media:** PeerJS (WebRTC)

### ⚙️ Installation & Setup

1.  **Clone or Download the Repository**
    Ensure your folder structure looks like this:
    ```text
    /
    ├── public/
    │   ├── index.html   (Client code)
    │   ├── usr1.png     (Avatar image - optional)
    │   └── ...
    ├── server.js        (Server code)
    └── package.json
    ```

2.  **Install Dependencies**
    Open your terminal in the project directory:
    ```bash
    npm init -y
    npm install express socket.io
    ```

3.  **Run the Server**
    ```bash
    node server.js
    ```

4.  **Access the Game**
    Open your browser and go to: `http://localhost:3000`

### 🎮 Controls

| Key | Action |
| :--- | :--- |
| **W, A, S, D** | Move Character |
| **Enter** | Open Chat / Send Message |
| **F** | Toggle Microphone (On/Off) |
| **C** | Toggle Camera (On/Off) |
| **Q** | Open Emoji Picker |
| **E** | Interact / Build Room (on empty plots) |
| **G** | Open Whiteboard (inside a room) |
| **H** | Open Notepad (inside a room) |
| **M** | Open Music Box (inside a room) |

---

## 🇹🇷 Türkçe

**Locmind**, kullanıcıların avatarlarıyla etkileşime geçebileceği, gerçek zamanlı sesli ve görüntülü sohbet edebileceği, odalar kurup iş birliği yapabileceği web tabanlı 2D bir sanal evrendir. HTML5 Canvas üzerinde çalışır ve iletişim için WebRTC kullanır.

### 🚀 Özellikler

* **🕹️ 2D Sanal Dünya:** Akıcı hareket mekaniğine sahip interaktif dünya.
* **🔊 Yakınlık Bazlı Ses (Proximity Voice):** Kullanıcılar birbirine yaklaştıkça ses artar, uzaklaştıkça azalır.
* **📹 Görüntülü Görüşme:** WebRTC (PeerJS) ile düşük gecikmeli kamera paylaşımı.
* **🏠 Oda Sistemi:**
    * Şifreli özel odalar oluşturma.
    * Konferans alanları ve kapı mekaniği.
* **⚽ Mini Oyunlar:** Fizik tabanlı top mekaniğine sahip futbol stadyumu.
* **🛠️ İş Birliği Araçları:**
    * **Ortak Beyaz Tahta:** Eş zamanlı çizim yapılabilen tahta.
    * **Ortak Not Defteri:** Herkesin düzenleyebileceği metin editörü (.txt çıktı alma özellikli).
    * **Ekran Paylaşımı:** Ekranınızı odadaki diğer kişilere yansıtın.
* **🎵 Müzik Kutusu:** YouTube videolarını odadaki herkesle senkronize izleyin.
* **💤 AFK Sistemi:** **30 dakika** boyunca hareketsiz kalan kullanıcılar sunucudan atılır.

### 🛠️ Teknolojiler

* **Frontend:** HTML5, CSS3, Vanilla JavaScript, Canvas API
* **Backend:** Node.js, Express.js
* **Gerçek Zamanlı İletişim:** Socket.io
* **P2P Medya:** PeerJS (WebRTC)

### ⚙️ Kurulum

1.  **Dosyaları Hazırlayın**
    Klasör yapınızın şu şekilde olduğundan emin olun:
    ```text
    /
    ├── public/
    │   ├── index.html   (İstemci kodu)
    │   ├── usr1.png     (Avatar görseli - opsiyonel)
    │   └── ...
    ├── server.js        (Sunucu kodu)
    └── package.json
    ```

2.  **Gerekli Paketleri Yükleyin**
    Terminali proje klasöründe açın ve şu komutları girin:
    ```bash
    npm init -y
    npm install express socket.io
    ```

3.  **Sunucuyu Başlatın**
    ```bash
    node server.js
    ```

4.  **Oyuna Giriş Yapın**
    Tarayıcınızdan şu adrese gidin: `http://localhost:3000`

### 🎮 Kontroller

| Tuş | İşlem |
| :--- | :--- |
| **W, A, S, D** | Hareket Et |
| **Enter** | Sohbeti Aç / Mesaj Gönder |
| **F** | Mikrofonu Aç/Kapa |
| **C** | Kamerayı Aç/Kapa |
| **Q** | Emoji Seçiciyi Aç |
| **E** | Etkileşim / Oda Kur (boş arsadayken) |
| **G** | Beyaz Tahtayı Aç (oda içindeyken) |
| **H** | Not Defterini Aç (oda içindeyken) |
| **M** | Müzik Kutusunu Aç (oda içindeyken) |

---
*Developed with ❤️ using Node.js & Socket.io*
