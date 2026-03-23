import mysql from 'mysql2/promise';
import axios from 'axios';

/**
 * Order Tracking Service
 * Connects to OpenCart database and Ship Logic API for real-time order tracking
 */
export class OrderTrackingService {
    private dbConfig: mysql.ConnectionOptions;
    private tablePrefix: string;
    private shipLogicApiKey: string;

    constructor() {
        // OpenCart database connection config
        this.dbConfig = {
            host: process.env.OPENCART_DB_HOST,
            port: parseInt(process.env.OPENCART_DB_PORT || '3306'),
            user: process.env.OPENCART_DB_USER,
            password: process.env.OPENCART_DB_PASSWORD,
            database: process.env.OPENCART_DB_NAME,
            connectTimeout: 5000,
        };

        this.tablePrefix = process.env.OPENCART_TABLE_PREFIX || 'oc_';
        this.shipLogicApiKey = process.env.SHIP_LOGIC_API_KEY || '';
    }

    /**
     * Get database connection
     */
    private async getConnection(): Promise<mysql.Connection> {
        try {
            return await mysql.createConnection(this.dbConfig);
        } catch (error: any) {
            console.error('[OrderTracking] Database connection error:', error.message);
            throw new Error('Unable to connect to order database. Check your OPENCART_DB_ environment variables.');
        }
    }

    /**
     * Format order information for AI agent
     */
    private formatOrderInfo(orderInfo: any): string {
        if (!orderInfo.found) {
            return orderInfo.message;
        }

        const { order } = orderInfo;
        let formatted = `📦 ORDER #${order.orderNumber}\n\n`;

        formatted += `Status: ${order.status}\n`;
        formatted += `Order Date: ${new Date(order.orderDate).toLocaleDateString('en-ZA')}\n`;
        formatted += `Total: ${order.total}\n\n`;

        formatted += `Customer: ${order.customer.name}\n`;
        formatted += `Email: ${order.customer.email}\n`;
        formatted += `Phone: ${order.customer.phone}\n\n`;

        formatted += `Shipping:\n`;
        formatted += `Method: ${order.shipping.method}\n`;
        formatted += `Address: ${order.shipping.address}\n\n`;

        if (order.tracking) {
            formatted += `📍 TRACKING INFORMATION:\n`;
            formatted += `Tracking Number: ${order.tracking.trackingNumber}\n`;
            formatted += `Carrier: ${order.tracking.carrier}\n`;
            formatted += `Status: ${order.tracking.status}\n`;
            if (order.tracking.currentLocation) {
                formatted += `Current Location: ${order.tracking.currentLocation}\n`;
            }
            if (order.tracking.estimatedDelivery) {
                formatted += `Estimated Delivery: ${new Date(order.tracking.estimatedDelivery).toLocaleDateString('en-ZA')}\n`;
            }
            formatted += '\n';
        }

        formatted += `Products:\n`;
        order.products.forEach((product: any, idx: number) => {
            formatted += `${idx + 1}. ${product.name} (${product.model}) - Qty: ${product.quantity} - ${product.price}\n`;
        });

        if (order.history && order.history.length > 0) {
            formatted += `\nRecent Updates:\n`;
            order.history.slice(0, 3).forEach((h: any) => {
                formatted += `- ${new Date(h.date).toLocaleDateString('en-ZA')}: ${h.status}`;
                if (h.comment) {
                    formatted += ` - ${h.comment}`;
                }
                formatted += '\n';
            });
        }

        return formatted;
    }

    /**
     * Get Ship Logic tracking information
     */
    private async getShipLogicTracking(orderNumber: string): Promise<any> {
        if (!this.shipLogicApiKey) {
            console.log('[OrderTracking] ShipLogic API key not configured.');
            return null;
        }

        try {
            const response = await axios.get(`https://api.shiplogic.com/v2/track/${orderNumber}`, {
                headers: {
                    'Authorization': `Bearer ${this.shipLogicApiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 5000,
            });

            if (response.data && response.data.tracking) {
                return {
                    trackingNumber: response.data.tracking.tracking_number,
                    carrier: response.data.tracking.carrier,
                    status: response.data.tracking.status,
                    estimatedDelivery: response.data.tracking.estimated_delivery,
                    currentLocation: response.data.tracking.current_location,
                    events: response.data.tracking.events || [],
                };
            }

            return null;
        } catch (error: any) {
            console.log('[OrderTracking] Ship Logic API not available or order not on ShipLogic yet:', error.message);
            return null;
        }
    }

    /**
     * Track order by order number
     */
    public async trackOrderFormatted(orderNumber: string): Promise<string> {
        let connection: mysql.Connection | null = null;
        try {
            connection = await this.getConnection();

            // Query OpenCart database for order
            const [orders] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT 
          o.order_id, 
          o.invoice_no, 
          o.firstname, 
          o.lastname, 
          o.email, 
          o.telephone, 
          o.total, 
          o.currency_code, 
          o.order_status_id,
          os.name as status_name,
          o.date_added,
          o.date_modified,
          o.shipping_method,
          o.shipping_address_1,
          o.shipping_address_2,
          o.shipping_city,
          o.shipping_postcode,
          o.shipping_country
        FROM ${this.tablePrefix}order o
        LEFT JOIN ${this.tablePrefix}order_status os ON o.order_status_id = os.order_status_id AND os.language_id = 1
        WHERE o.order_id = ? OR o.invoice_no = ?
        LIMIT 1`,
                [orderNumber, orderNumber]
            );

            if (orders.length === 0) {
                return `Order ${orderNumber} not found in our system. Please check the order number and try again.`;
            }

            const order = orders[0];

            // Get order products
            const [products] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT
                    name,
                    model,
                    quantity,
                    price,
                    total 
                 FROM ${this.tablePrefix}order_product 
                 WHERE order_id = ?`,
                [order.order_id]
            );

            // Get order history (status changes)
            const [history] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT
                oh.date_added,
                    os.name as status,
                    oh.comment,
                    oh.notify 
        FROM ${this.tablePrefix}order_history oh
        LEFT JOIN ${this.tablePrefix}order_status os ON oh.order_status_id = os.order_status_id AND os.language_id = 1
        WHERE oh.order_id = ?
                    ORDER BY oh.date_added DESC`,
                [order.order_id]
            );

            // Try to get tracking from Ship Logic API
            const trackingInfo = await this.getShipLogicTracking(order.order_id.toString());

            const orderInfo = {
                found: true,
                order: {
                    orderNumber: order.order_id,
                    invoiceNumber: order.invoice_no,
                    customer: {
                        name: `${order.firstname} ${order.lastname}`,
                        email: order.email,
                        phone: order.telephone,
                    },
                    status: order.status_name,
                    statusId: order.order_status_id,
                    orderDate: order.date_added,
                    lastUpdate: order.date_modified,
                    total: `${order.currency_code} ${parseFloat(order.total).toFixed(2)}`,
                    shipping: {
                        method: order.shipping_method,
                        address: `${order.shipping_address_1}${order.shipping_address_2 ? ', ' + order.shipping_address_2 : ''}, ${order.shipping_city}, ${order.shipping_postcode}, ${order.shipping_country}`,
                    },
                    products: products.map(p => ({
                        name: p.name,
                        model: p.model,
                        quantity: p.quantity,
                        price: `${order.currency_code} ${parseFloat(p.price).toFixed(2)}`,
                    })),
                    history: history.map(h => ({
                        date: h.date_added,
                        status: h.status,
                        comment: h.comment,
                    })),
                    tracking: trackingInfo,
                }
            };

            return this.formatOrderInfo(orderInfo);
        } catch (error: any) {
            console.error('[OrderTracking] Error tracking order:', error);
            return `Sorry, I encountered an error while trying to fetch the tracking information for order ${orderNumber}. This might be due to a temporary database connection issue. Please try again later or ask to be connected to the Audico team.`;
        } finally {
            if (connection) {
                try {
                    await connection.end();
                } catch (e) {
                    console.error('[OrderTracking] Error closing connection:', e);
                }
            }
        }
    }

    /**
     * Check product stock availability
     */
    public async checkProductStock(searchQuery: string): Promise<string> {
        let connection: mysql.Connection | null = null;
        try {
            connection = await this.getConnection();

            const terms = searchQuery.trim().split(/\s+/).filter(t => t.length > 0);
            
            if (terms.length === 0) {
                return "Please provide a valid product name to search for stock.";
            }

            let whereClause = `pd.language_id = 1 AND p.status = 1`;
            const queryParams: any[] = [];

            const termConditions = terms.map(term => {
                queryParams.push(`%${term}%`); // for name
                queryParams.push(`%${term}%`); // for model
                return '(pd.name LIKE ? OR p.model LIKE ?)';
            });
            
            if (termConditions.length > 0) {
                whereClause += ' AND (' + termConditions.join(' AND ') + ')';
            }

            // Query OpenCart database for product stock
            const [products] = await connection.execute<mysql.RowDataPacket[]>(
                `SELECT 
                    pd.name, 
                    p.model, 
                    p.quantity, 
                    p.price, 
                    ss.name as stock_status 
                 FROM ${this.tablePrefix}product p 
                 LEFT JOIN ${this.tablePrefix}product_description pd ON p.product_id = pd.product_id 
                 LEFT JOIN ${this.tablePrefix}stock_status ss ON p.stock_status_id = ss.stock_status_id AND ss.language_id = 1
                 WHERE ${whereClause}
                 LIMIT 10`,
                queryParams
            );

            if (products.length === 0) {
                return `No products found matching "${searchQuery}". Please check the spelling or try a more general search.`;
            }

            let response = `Found ${products.length} product(s) matching "${searchQuery}":\n\n`;

            products.forEach((p, index) => {
                const stockMsg = p.quantity > 0
                    ? `${p.quantity} in stock`
                    : `0 in stock (${p.stock_status})`;

                response += `${index + 1}. **${p.name}**\n`;
                response += `   - Model: ${p.model}\n`;
                response += `   - Stock: ${stockMsg}\n\n`;
            });

            return response;

        } catch (error: any) {
            console.error('[StockCheck] Error checking stock:', error);
            return `Sorry, I encountered an error while trying to check stock for "${searchQuery}". Please try again or ask the Audico team.`;
        } finally {
            if (connection) {
                try {
                    await connection.end();
                } catch (e) {
                    console.error('[StockCheck] Error closing connection:', e);
                }
            }
        }
    }
}

// Singleton instance
export const orderTrackingService = new OrderTrackingService();
