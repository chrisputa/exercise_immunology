// import this alway
import type {ImageMetadata} from 'astro:assets'; // always import this

// dark logo, this is auto-generated from ../assets/logo.png, you can replace it with your own dark logo if you want, but make sure to keep the same name and path
import logoDark from '../assets/generated/logo_dark.png';

// light logo
import logoLight from '../assets/logo.png';


export type Image = {
    src: ImageMetadata;
    alt?: string;
    caption?: string;
};

export type Author = {
    name: string;
    image?: Image;
    url?: string;
}

export type Link = {
    text: string;
    href: string;
    target?: string;
    rel?: string;
};

export type Hero = {
    title?: string;
    text?: string;
    image?: Image;
    actions?: Link[];
};

export type Subscribe = {
    title?: string;
    text?: string;
    formUrl: string;
};

export type SiteConfig = {
    website: string;
    author: Author;
    logo?: Image;
    title: string;
    subtitle?: string;
    description: string;
    image?: Image;
    headerNavLinks?: Link[];
    footerNavLinks?: Link[];
    socialLinks?: Link[];
    hero?: Hero;
    subscribe?: Subscribe;
    postsPerPage?: number;
    projectsPerPage?: number;
};

const siteConfig: SiteConfig = {
    logo: {
        src: logoLight.src,
        alt: 't-cell logo'
    },
    logoDark: {
        src: logoDark.src,
        alt: 't-cell logo dark'
    },
    website: 'https://chrisputa.github.io/',
    base: '/exercise_immunology/',
    title: 'Exercise Immunology',
    author: {
        name: 'Christian Puta',
        url: 'https://chrisputa.github.io/'
    },
    subtitle: '',
    description: '',
    headerNavLinks: [
        {
            text: 'Home',
            href: '/'
        },
        {
            text: 'Lectures',
            href: '/lectures'
        },
        {
            text: 'Dashboards',
            href: '/dashboards'
        },
        {
            text: 'Tutorials',
            href: '/tutorials'
        },
        {
            text: 'Contact',
            href: '/contact'
        }
    ],
    footerNavLinks: [

        {
            text: 'Contact',
            href: '/contact'
        }, {
            text: 'Terms',
            href: '/terms'
        }
    ],
    socialLinks: [

    ],


    postsPerPage: 8,
    projectsPerPage: 8
};

export default siteConfig;
