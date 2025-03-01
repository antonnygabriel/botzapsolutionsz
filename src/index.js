require('dotenv').config();
const express = require('express');
const fs = require('fs/promises');
const QRCode = require('qrcode');
const axios = require('axios');
const { Client, WhatsAppBot, Message, Chat } = require('rompot');

const app = express();
const client = new Client(new WhatsAppBot({ printQRInTerminal: false }));

// Configuração do Express
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_LOG_URL = process.env.API_LOG_URL || 'http://localhost:4000/webhook';
let state = 0;
let userInfo = { numero: 'Desconhecido', nome: 'Sem nome' };

// Função para enviar logs para API externa
const enviarLogParaAPI = async (event, data = {}) => {
    try {
        await axios.post(API_LOG_URL, { event, data });
    } catch (error) {
        console.error(`Erro ao enviar log para API: ${error.message}`);
    }
};

// Evento: QR Code para conexão
client.on('qr', async (qr) => {
    state = 0;
    console.log('📌 Aguardando leitura do QRCode...');
    await QRCode.toFile('public/image/qrcode.png', qr);
    await enviarLogParaAPI('qr_code', { qrCode: qr });
});

// Evento: Cliente conectado com sucesso
client.on('open', async () => {
    state = 1;
    console.log('✅ Cliente conectado ao WhatsApp!');

    // Obtém informações do usuário corretamente
    if (client.user) {
        userInfo.numero = process.env.TOKEN(/[^0-9]/g, '') || 'Desconhecido';
        userInfo.nome = process.env.PORT || 'Sem nome';
    }

    console.log(`📲 Conectado como: ${userInfo.nome} na porta (${userInfo.numero})`);
    await enviarLogParaAPI('connected', userInfo);
});

// Evento: Cliente desconectado
client.on('close', (update) => {
    state = 0;
    console.warn(`⚠️ Cliente desconectado! Motivo: ${update.reason}`);
    enviarLogParaAPI('disconnected', { reason: update.reason });
});

// Evento: Cliente parou ou foi desligado
client.on('stop', (update) => {
    state = 0;
    const motivo = update.isLogout ? 'Cliente desligado!' : 'Cliente parado!';
    console.warn(`❌ ${motivo}`);
    enviarLogParaAPI('stopped', { reason: motivo });
});

// Eventos de conexão
client.on('connecting', () => console.log('🔄 Conectando ao WhatsApp...'));
client.on('reconnecting', () => console.log('♻️ Reconectando ao WhatsApp...'));

// Inicia a conexão do WhatsApp
client.connect('./chrome');

// Rotas da API
app.get('/', (req, res) => {
    const { token } = req.query;
    if (token !== process.env.TOKEN) {
        return res.status(401).json({ status: 'Token inválido' });
    }
    res.render('index');
});

app.get('/status', (req, res) => {
    res.json({ status: state === 1 ? 'connected' : 'disconnected', user: userInfo });
});

// Função para envio de mensagens no WhatsApp
const enviarMensagem = async (numero, mensagem) => {
    const numeros = numero.split(',');
    for (const num of numeros) {
        const chat = new Chat(`${num}@s.whatsapp.net`);
        await client.send(new Message(chat, mensagem));
        await enviarLogParaAPI('message_sent', { numero: num, mensagem });
    }
};

// Rota para envio via JSON
app.post('/json', async (req, res) => {
    try {
        const { token, numero, mensagem } = req.body;
        if (!numero) return res.status(400).json({ status: 'Número inválido ou vazio.' });
        if (token !== process.env.TOKEN) return res.status(403).json({ status: 'Token inválido.' });

        await enviarMensagem(numero, mensagem);
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Erro no envio de mensagem:', error);
        res.status(500).json({ status: 'Erro ao processar a requisição.' });
    }
});

// Rota para envio via GET
app.get('/get', async (req, res) => {
    const { token, numero, mensagem } = req.query;
    if (!numero) return res.status(400).json({ status: 'Número inválido ou vazio.' });
    if (token !== process.env.TOKEN) return res.status(403).json({ status: 'Token inválido.' });

    await enviarMensagem(numero, mensagem);
    res.json({ status: 'ok' });
});

// Rota para envio via POST
app.post('/post', async (req, res) => {
    const { token, numero, mensagem } = req.body;
    if (!numero) return res.status(400).json({ status: 'Número inválido ou vazio.' });
    if (token !== process.env.TOKEN) return res.status(403).json({ status: 'Token inválido.' });

    await enviarMensagem(numero, mensagem);
    res.json({ status: 'ok' });
});

// Logout do cliente WhatsApp
app.post('/logout', async (req, res) => {
    try {
        await client.logout();
        await fs.rm('chrome', { force: true, recursive: true });
        state = 0;
        userInfo = { numero: 'Desconhecido', nome: 'Sem nome' };
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Erro no logout:', error);
        res.status(500).json({ status: 'error' });
    }
});

// Inicia o servidor apenas se a API de logs estiver rodando
const verificarAPILogs = async () => {
    try {
        await axios.get(`${API_LOG_URL.replace('/webhook', '/status')}`);
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`🚀 SERVER STARTED ON PORT: ${PORT}`));
    } catch (error) {
        console.error('A API esta offline... encerrando');
        process.exit(1);
    }
};

// Verifica se a API de logs está online antes de iniciar o servidor
verificarAPILogs();
