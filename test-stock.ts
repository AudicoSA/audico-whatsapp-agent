import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

async function testStock() {
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
        const query = '%kef ls50%';
        const [rows] = await connection.execute(
            `SELECT pd.name, p.model, p.quantity, p.price, p.stock_status_id 
       FROM ${tablePrefix}product p 
       LEFT JOIN ${tablePrefix}product_description pd ON p.product_id = pd.product_id 
       LIMIT 5`
        );
        console.log(rows);
        await connection.end();
    } catch (err) {
        console.error(err);
    }
}

testStock();
