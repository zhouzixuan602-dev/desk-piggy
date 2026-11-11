// The pig's vocabulary. Each key maps to a few lines; one is picked at random.

export const STRINGS = {
  zh: {
    name: '小猪',
    hello: ['嗨～我是{name}！', '哼哼，你好呀～', '今天也要开心哦！'],
    poke: ['哼哼～', '嘿嘿', '好痒～', '再摸摸嘛'],
    wake: ['唔…醒啦！', '早呀～'],
    sleep: ['困困…晚安', '我眯一会儿…'],
    dance: ['看我的！', '跳起来～'],
    eat: ['开饭啦！', '是苹果耶！'],
    eatDone: ['嗝～吃饱啦', '好吃好吃～'],
    siri: ['我在听～', '嗯嗯，你说～', '来啦来啦！'],
    come: ['来啦～'],
    drag: ['哇啊——', '飞起来啦～', '放我下来嘛'],
    land: ['哎哟！'],
    bye: ['拜拜～一会儿见'],
    back: ['我回来啦！'],
    custom: ['{text}'],
  },
  en: {
    name: 'Piggy',
    hello: ["Hi! I'm {name}!", 'Oink, hello there~', 'Have a lovely day!'],
    poke: ['Oink~', 'Hehe', 'That tickles!', 'More pats please'],
    wake: ["Mm… I'm up!", 'Morning~'],
    sleep: ['So sleepy… night night', 'Just a quick nap…'],
    dance: ['Watch this!', "Let's dance~"],
    eat: ['Snack time!', 'Ooh, an apple!'],
    eatDone: ['Burp~ all full', 'Yum yum~'],
    siri: ["I'm listening~", 'Mm-hm, go on~', 'Coming!'],
    come: ['Coming~'],
    drag: ['Whoa—', "I'm flying~", 'Put me down!'],
    land: ['Oof!'],
    bye: ['Bye~ see you soon'],
    back: ["I'm back!"],
    custom: ['{text}'],
  },
};

export const pickLang = (tag = 'en') => (String(tag).toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function line(lang, key, vars = {}, rng = Math.random) {
  const table = STRINGS[lang] || STRINGS.en;
  const options = table[key];
  if (!options || !options.length) return '';
  const text = options[Math.floor(rng() * options.length) % options.length];
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : k === 'name' ? table.name : ''));
}
