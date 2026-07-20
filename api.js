async function send(){

const input=document.getElementById("msg");

const text=input.value;

if(!text)return;

document.getElementById("chat").innerHTML+=`
<p><b>Kamu:</b> ${text}</p>
`;

input.value="";

const res=await fetch("/api/chat",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({

message:text

})

});

const data=await res.json();

document.getElementById("chat").innerHTML+=`
<p><b>AI:</b> ${data.reply}</p>
`;

}
