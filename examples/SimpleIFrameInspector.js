/**
 * Simple IFrame Inspector
 * 
 * A minimal script to inspect the conversation iframe content
 * Copy and paste this entire file into the browser console
 */

// Step 1: Find the iframe
console.log("=== Simple IFrame Inspector ===");
const iframe = document.getElementById('SidePanelIFrame');

if (!iframe) {
    console.error("❌ Iframe not found!");
    console.log("Available iframes:", document.querySelectorAll('iframe'));
} else {
    console.log("✓ Found iframe:", iframe.id);
    
    // Step 2: Access the iframe document
    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        
        if (!doc) {
            console.error("❌ Cannot access iframe document");
        } else {
            console.log("✓ Accessed iframe document");
            
            // Step 3: Show what's inside
            console.log("\n--- IFrame Content ---");
            console.log("Body text length:", doc.body.textContent.length, "characters");
            console.log("\nFirst 500 characters of text:");
            console.log(doc.body.textContent.substring(0, 500));
            
            console.log("\n--- IFrame HTML ---");
            console.log("First 1000 characters of HTML:");
            console.log(doc.body.innerHTML.substring(0, 1000));
            
            // Step 4: Find all divs with content
            console.log("\n--- Divs with Content ---");
            const divs = Array.from(doc.querySelectorAll('div')).filter(d => d.textContent.trim().length > 20);
            console.log(`Found ${divs.length} divs with substantial content`);
            
            if (divs.length > 0) {
                console.log("\nFirst 10 divs:");
                divs.slice(0, 10).forEach((div, i) => {
                    const text = div.textContent.trim().substring(0, 80);
                    const classes = div.className ? `class="${div.className}"` : '';
                    const id = div.id ? `id="${div.id}"` : '';
                    console.log(`  ${i + 1}. <div ${id} ${classes}>`);
                    console.log(`     Text: "${text}..."`);
                });
            }
            
            // Step 5: Look for any elements with specific attributes
            console.log("\n--- Elements with Interesting Attributes ---");
            
            const roleElements = doc.querySelectorAll('[role]');
            if (roleElements.length > 0) {
                console.log(`\nElements with role attribute: ${roleElements.length}`);
                Array.from(roleElements).slice(0, 5).forEach((el, i) => {
                    console.log(`  ${i + 1}. <${el.tagName.toLowerCase()} role="${el.getAttribute('role')}">`);
                });
            }
            
            const ariaElements = doc.querySelectorAll('[aria-label]');
            if (ariaElements.length > 0) {
                console.log(`\nElements with aria-label: ${ariaElements.length}`);
                Array.from(ariaElements).slice(0, 5).forEach((el, i) => {
                    console.log(`  ${i + 1}. aria-label="${el.getAttribute('aria-label')}"`);
                });
            }
            
            const dataIdElements = doc.querySelectorAll('[data-id]');
            if (dataIdElements.length > 0) {
                console.log(`\nElements with data-id: ${dataIdElements.length}`);
                Array.from(dataIdElements).slice(0, 5).forEach((el, i) => {
                    console.log(`  ${i + 1}. data-id="${el.getAttribute('data-id')}"`);
                });
            }
            
            console.log("\n=== Inspection Complete ===");
            console.log("\nTo further investigate, run these commands:");
            console.log("  iframe.contentDocument.body          // See the body element");
            console.log("  iframe.contentDocument.body.innerHTML // See all HTML");
            console.log("  iframe.contentDocument.querySelector(...) // Find specific elements");
        }
    } catch (e) {
        console.error("❌ Error accessing iframe:", e.message);
        console.log("This might be a cross-origin restriction");
    }
}
