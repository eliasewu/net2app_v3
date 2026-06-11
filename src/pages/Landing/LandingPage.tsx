import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Zap, Globe, Smartphone, CreditCard, BarChart3 } from 'lucide-react';
import { Button } from '../../components/UI/Button';
import { Input, Select } from '../../components/UI/Input';
import { Card } from '../../components/UI/Card';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [showStripe, setShowStripe] = useState(false);
  const [showPiprapay, setShowPiprapay] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(99);
  const [paymentPlan, setPaymentPlan] = useState('stallion');

  const rates = [
    { country: 'United States', rate: '€0.010', flag: '🇺🇸' },{ country: 'United Kingdom', rate: '€0.012', flag: '🇬🇧' },
    { country: 'Germany', rate: '€0.015', flag: '🇩🇪' },{ country: 'France', rate: '€0.014', flag: '🇫🇷' },
    { country: 'Spain', rate: '€0.016', flag: '🇪🇸' },{ country: 'Italy', rate: '€0.017', flag: '🇮🇹' },
    { country: 'India', rate: '€0.008', flag: '🇮🇳' },{ country: 'Bangladesh', rate: '€0.006', flag: '🇧🇩' },
  ];

  const plans = [
    { name: 'Stallion', price: 150, sms: '100,000', features: ['SMPP','HTTP API','Basic Routing'] },
    { name: 'Retail', price: 299, sms: '500,000', features: ['SMPP','HTTP','WhatsApp','Telegram','Voice OTP'] },
    { name: 'Enterprise', price: 399, sms: '2,500,000', features: ['All channels','RCS','Custom Branding','Dedicated Server','24/7 Support'] },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-white/95 backdrop-blur shadow-sm z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2"><span className="text-2xl">📡</span><span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">NET2APP Hub</span></div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/login')}>Sign In</Button>
            <Button onClick={() => navigate('/login')}>Get Started Free</Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 pb-16 bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 leading-tight">
            Enterprise SMS Platform for <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Global Communication</span>
          </h1>
          <p className="mt-4 text-lg text-gray-600">Multi-channel SMS with SMPP, HTTP, WhatsApp, Telegram, RCS & Voice OTP. Route millions through 50+ API providers.</p>
          <div className="mt-6 flex gap-3 justify-center">
            <Button size="lg" onClick={() => navigate('/login')}>Sign In Now</Button>
            <Button variant="secondary" size="lg" onClick={() => document.getElementById('contact')?.scrollIntoView({behavior:'smooth'})}>Request Demo</Button>
          </div>
        </div>
      </section>

      {/* Live Rates */}
      <section className="py-3 bg-gradient-to-r from-blue-600 to-indigo-600 overflow-hidden">
        <div className="flex gap-6 px-6 animate-pulse">
          {[...rates,...rates].map((r,i)=><div key={i} className="flex items-center gap-2 text-white whitespace-nowrap shrink-0"><span>{r.flag}</span><span className="text-sm font-medium">{r.country}</span><span className="font-bold">{r.rate}</span></div>)}
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-10">Enterprise Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[{icon:<Shield size={28}/>,title:'Security',desc:'TLS 1.3 encryption for all connections'},
              {icon:<Zap size={28}/>,title:'2000+ TPS',desc:'High-throughput sub-millisecond routing'},
              {icon:<Globe size={28}/>,title:'50+ Connectors',desc:'Twilio, Vonage, Infobip, Sinch & more'},
              {icon:<Smartphone size={28}/>,title:'Multi-Channel',desc:'SMPP/HTTP/WhatsApp/Telegram/RCS/Voice'},
              {icon:<CreditCard size={28}/>,title:'Real-time Billing',desc:'DLR-based charging, auto invoicing'},
              {icon:<BarChart3 size={28}/>,title:'Smart Routing',desc:'LCR, percentage, priority with auto-failover'}]
              .map((f,i)=><div key={i} className="p-5 rounded-xl border hover:shadow-lg hover:border-blue-200 transition-all"><div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 mb-3">{f.icon}</div><h3 className="font-semibold mb-1">{f.title}</h3><p className="text-sm text-gray-600">{f.desc}</p></div>)}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-10">Pricing Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((p,i)=><div key={i} className="bg-white rounded-2xl border p-7">
              <h3 className="text-lg font-bold">{p.name}</h3>
              <div className="mt-3"><span className="text-3xl font-extrabold">€{p.price}</span>/mo</div>
              <p className="text-sm text-gray-500 mt-1">Up to {p.sms} SMS</p>
              <div className="mt-5 space-y-2">{p.features.map((f,j)=><div key={j} className="text-sm text-gray-600">✓ {f}</div>)}</div>
              <div className="mt-6 flex flex-col gap-2">
                <Button size="sm" className="w-full" onClick={()=>{setPaymentPlan(p.name.toLowerCase());setPaymentAmount(p.price);setShowStripe(true);}}>Pay with Stripe</Button>
                <Button size="sm" variant="secondary" className="w-full" onClick={()=>{setPaymentPlan(p.name.toLowerCase());setPaymentAmount(p.price);setShowPiprapay(true);}}>Pay with Piprapay</Button>
              </div>
            </div>)}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-16 bg-white">
        <div className="max-w-lg mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-6">Get a Free Demo</h2>
          <Card>
            <form className="space-y-3" onSubmit={e=>{e.preventDefault();alert('Demo request submitted!');}}>
              <div className="grid grid-cols-2 gap-3"><Input label="Full Name" required /><Input label="Email" type="email" required /></div>
              <Input label="Company" />
              <Select label="Interested In" options={[{value:'sms',label:'SMS Platform'},{value:'voice',label:'Voice OTP'},{value:'whatsapp',label:'WhatsApp API'}]} />
              <Button type="submit" className="w-full">Request Demo</Button>
            </form>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10">
        <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div><div className="text-white font-bold text-lg mb-2">📡 NET2APP Hub</div><p className="text-sm">Enterprise SMS platform.</p></div>
          <div><h4 className="text-white font-semibold mb-2">Product</h4><div className="text-sm space-y-1"><p>Features</p><p>Pricing</p><p>API Docs</p></div></div>
          <div><h4 className="text-white font-semibold mb-2">Company</h4><div className="text-sm space-y-1"><p>About</p><p>Contact</p><p>Careers</p></div></div>
          <div><h4 className="text-white font-semibold mb-2">Contact</h4><div className="text-sm space-y-1"><p>support@net2app.com</p><p>+1-800-SMS-HUB</p></div></div>
        </div>
      </footer>

      {/* Stripe Modal */}
      {showStripe&&<div className="fixed inset-0 z-50 flex items-center justify-center"><div className="absolute inset-0 bg-black/50" onClick={()=>setShowStripe(false)}/><div className="relative bg-white rounded-2xl p-6 w-full max-w-sm"><h3 className="font-bold text-lg mb-3">Pay with Stripe 💳</h3><p className="text-sm text-gray-600 mb-3">Plan: {paymentPlan} - €{paymentAmount}/mo</p><Input placeholder="4242 4242 4242 4242" /><Input placeholder="Cardholder Name" /><Button className="w-full mt-3" onClick={()=>{alert('Processing...');setShowStripe(false);}}>Pay €{paymentAmount}</Button></div></div>}

      {/* Piprapay Modal */}
      {showPiprapay&&<div className="fixed inset-0 z-50 flex items-center justify-center"><div className="absolute inset-0 bg-black/50" onClick={()=>setShowPiprapay(false)}/><div className="relative bg-white rounded-2xl p-6 w-full max-w-sm"><h3 className="font-bold text-lg mb-3">Pay with Piprapay 💰</h3><p className="text-sm text-gray-600 mb-3">Plan: {paymentPlan} - €{paymentAmount}/mo</p><Button className="w-full" onClick={()=>{alert('Redirecting to Piprapay...');setShowPiprapay(false);}}>Proceed to Piprapay</Button></div></div>}
    </div>
  );
};
