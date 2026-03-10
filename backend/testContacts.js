async function testContacts() {
  const headers1 = {
    'Authorization': 'Bearer [REDACTED_API_SECRET]',
    'x-agent-id': 'agent-test-1',
    'Content-Type': 'application/json'
  };

  const headers2 = {
    'Authorization': 'Bearer [REDACTED_API_SECRET]',
    'x-agent-id': 'agent-test-2',
    'Content-Type': 'application/json'
  };

  console.log("-> Criando contatos para o agent-test-1");
  await fetch('http://localhost:3000/api/contacts', { method: 'POST', headers: headers1, body: JSON.stringify({ name: 'Tarcisio', phone: '5511999999999' }) });
  
  console.log("-> Checando a lista do agent-test-1 (Espera 1)");
  const res1 = await fetch('http://localhost:3000/api/contacts', { headers: headers1 });
  const data1 = await res1.json();
  console.log(data1);

  console.log("-> Checando a lista do agent-test-2 (Espera 0) - Isolamento de Dados!");
  const res2 = await fetch('http://localhost:3000/api/contacts', { headers: headers2 });
  const data2 = await res2.json();
  console.log(data2);
}

testContacts();
