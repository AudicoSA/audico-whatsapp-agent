import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

async function testCart() {
    try {
        const config = {
            host: process.env.OPENCART_DB_HOST,
            port: parseInt(process.env.OPENCART_DB_PORT || '3306'),
            user: process.env.OPENCART_DB_USER,
            password: process.env.OPENCART_DB_PASSWORD,
            database: process.env.OPENCART_DB_NAME,
            connectTimeout: 5000,
        };
        const connection = await mysql.createConnection(config);
        const tablePrefix = process.env.OPENCART_TABLE_PREFIX || 'oc_';

        // Inspect oc_cart
        const [cartRows] = await connection.execute(`SELECT * FROM ${tablePrefix}cart LIMIT 1`);
        console.log('Cart Schema:', Object.keys(cartRows[0] || {}));

        // Inspect oc_customer
        const [customerRows] = await connection.execute(`SELECT * FROM ${tablePrefix}customer LIMIT 1`);
        console.log('Customer Schema:', Object.keys(customerRows[0] || {}));

        await connection.end();
    } catch (err) {
        console.error(err);
    }
}

testCart();
