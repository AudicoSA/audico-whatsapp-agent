import 'dotenv/config';
import { supabase } from './lib/supabase';

async function test() {
    console.log("\nSearching for Control4 using native .textSearch...");
    const { data: textData, error: textErr } = await supabase
        .from('products')
        .select('product_name, brand, retail_price')
        .textSearch('product_name', 'Control4 Core 1', {
            type: 'websearch',
            config: 'english'
        })
        .limit(5);

    console.log("TextSearch Results:", textData);
    if (textErr) console.error("TextSearch Error:", textErr);

    console.log("\nSearching for valid product using native .textSearch...");
    const { data: validData, error: validErr } = await supabase
        .from('products')
        .select('product_name, brand, retail_price')
        .textSearch('product_name', 'Denon AVR', {
            type: 'websearch',
            config: 'english'
        })
        .limit(5);

    console.log("Valid TextSearch Results:", validData);
    if (validErr) console.error("Valid TextSearch Error:", validErr);
}
test();
