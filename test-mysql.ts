import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

async function testConnection() {
    console.log('Testing raw mysql2 connection...');
    try {
        const config = {
            host: process.env.OPENCART_DB_HOST,
            port: parseInt(process.env.OPENCART_DB_PORT || '3306'),
            user: process.env.OPENCART_DB_USER,
            password: process.env.OPENCART_DB_PASSWORD,
            database: process.env.OPENCART_DB_NAME,
            connectTimeout: 5000 // 5 seconds
        };
        console.log('Using config:', { ...config, password: '***' });

        // Test single connection first
        const connection = await mysql.createConnection(config);
        console.log('Connection successful!');

        // Test simple query
        const [rows] = await connection.execute('SELECT 1 as val');
        console.log('Query successful:', rows);

        await connection.end();
        console.log('Connection closed.');
    } catch (err) {
        console.error('Connection failed:', err);
    }
}

testConnection();
